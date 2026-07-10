import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo, useRef } from 'react';
import { DolibarrConfig, ThirdParty, Invoice, Product, Proposal, Order, Project, Task, BankAccount, BankLine, AgendaEvent, DolibarrUser, SupplierInvoice, SupplierOrder, Ticket, Warehouse, StockMovement, Intervention, ExpenseReport, RecruitmentJobPosition, Candidate, LeaveRequest, Contract, ManufacturingOrder, BOM, Shipment, Contact, AppNotification, DolibarrModule } from '../types';
import { DolibarrService } from '../services/dolibarrService';
import { dbService } from '../services/dbService';
import { WhatsAppService } from '../services/whatsappService';
import { useDolibarrData } from '../hooks/useDolibarrData';
import { runBackgroundSync } from '../services/backgroundSyncService';
import { logger } from '../utils/logger';
import { safeStorage } from '../utils/safeStorage';
import { resolveScreenAccess, ScreenPermissions } from '../utils/screenPermissions';
import { canDoAction } from '../utils/writePermissions';
import { RIGHTS_MAP } from '../utils/screenAccess';
import { getUiConfig } from '../services/uiConfigService';

const log = logger.child('DolibarrContext');

// Normalize Dolibarr user admin field (API returns number, string, or boolean)
const normalizeUser = (user: DolibarrUser): DolibarrUser => ({
  ...user,
  admin: (user.admin === 1 || user.admin === '1' || user.admin === true) ? 1 : 0
} as DolibarrUser);

export interface PreviewTarget {
  type: 'user' | 'group';
  id: string;
  name: string;
  groupIds: string[];
  // #540 (preciso): direitos REAIS do alvo (só p/ type='user') p/ o preview refletir
  // exatamente o que ele VÊ. Carregado ao entrar em preview; undefined enquanto carrega.
  rights?: DolibarrUser['rights'];
  admin?: number | string;
}

interface DolibarrContextType {
  config: DolibarrConfig | null;
  setConfig: (config: DolibarrConfig | null) => void;
  isLoading: boolean;
  error: string | null;
  notifications: AppNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>;
  refreshData: (options?: { forceFull?: boolean, limit?: number, page?: number, query?: string }) => Promise<void>;
  isSyncPaused: boolean;
  toggleSyncPause: () => void;
  isSyncing: boolean;
  currentUser?: DolibarrUser | null;
  canAccess: (module: string) => boolean;
  // FAZER: pode executar a ação (Novo/Editar/Excluir/Validar) nesta tela? Gateado pelos
  // direitos de escrita do Dolibarr (preview-aware). Default seguro: não bloqueia se não mapeado.
  canDo: (action: 'create' | 'edit' | 'delete' | 'validate' | 'pay' | 'approve' | 'receive' | 'close' | 'reopen', screen: string) => boolean;
  logout: () => void;
  isInitialized: boolean;
  previewTarget: PreviewTarget | null;
  setPreviewTarget: (target: PreviewTarget | null) => void;
  orgScreenPerms: import('../utils/screenPermissions').ScreenPermissions | null;
  userGroupIds: string[];
  // Re-resolvem direitos após edição de permissões (Central de Permissões), p/ canAccess/canDo e
  // o "Ver como" refletirem na hora sem relogar.
  refreshCurrentUser: () => Promise<void>;
  refreshPreviewTarget: () => Promise<void>;
}

const DolibarrContext = createContext<DolibarrContextType | undefined>(undefined);

export const DolibarrProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [config, setConfigState] = useState<DolibarrConfig | null>(null);
  const [isSyncPaused, setIsSyncPaused] = useState(false);
  const [currentUser, setCurrentUser] = useState<DolibarrUser | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);
  // #112 — overrides de tela por pessoa/grupo (org-wide) + grupos do usuário logado.
  const [orgScreenPerms, setOrgScreenPerms] = useState<ScreenPermissions | null>(null);
  const [userGroupIds, setUserGroupIds] = useState<string[]>([]);
  // #540 — preview "Ver como" (read-only, only affects canAccess/rendering)
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null);

  // 1. Permission Logic (Must be defined before data hook)
  // Acesso BASE (direitos Dolibarr), sem considerar os overrides de tela. Função pura por usuário.
  const computeBaseAccess = useCallback((module: string, user: DolibarrUser): boolean => {
    // 0. Public Modules (Accessible to everyone)
    if (module === 'dashboard') return true;

    // 1. Admin Override (normalized to number by normalizeUser)
    if (user.admin === 1) return true;

    if (!user.rights) {
      return false;
    }
    const currentUser = { ...user, rights: user.rights }; // rights já estreitado (não-undefined)

    // FONTE CANÔNICA (src/utils/screenAccess.ts) — de-dup do adversarial: antes esta cópia inline do
    // rightsMap podia DIVERGIR do screenAccess/permissionMatrix. A lógica de resolução abaixo é mantida.
    const rightsMap = RIGHTS_MAP;

    const mapping = rightsMap[module];
    if (mapping) {
      const moduleRights = currentUser.rights[mapping.module];
      if (!moduleRights) return false;

      for (const perm of mapping.perms) {
        if (perm.includes('.')) {
          const parts = perm.split('.');
          let currentLevel: any = moduleRights; // Start with the module's rights object
          let found = true;
          for (const part of parts) {
            if (currentLevel && typeof currentLevel === 'object' && currentLevel[part] !== undefined) {
              currentLevel = currentLevel[part];
            } else {
              found = false;
              break;
            }
          }
          if (found && (currentLevel === "1" || currentLevel === 1 || currentLevel === true)) return true;
        } else {
          if ((moduleRights[perm] as any) === "1" || (moduleRights[perm] as any) === 1 || (moduleRights[perm] as any) === true) return true;
        }
      }
      return false;
    }

    if (currentUser.rights[module]) {
      const r = currentUser.rights[module];
      if (r.read || r.lire || r.consulter) return true;
    }
    return false;
  }, []);

  // canAccess = acesso base + overrides de tela por pessoa/grupo (#112).
  // When previewTarget is active (#540), resolve as the simulated identity (not admin bypass).
  const canAccess = useCallback((module: string): boolean => {
    if (!config || !currentUser) return false;
    if (previewTarget) {
      // Preview ("ver como") PRECISO: simula a identidade do alvo SEM bypass do admin logado.
      // Para usuário com rights carregados, base = acesso REAL dele (computeBaseAccess sobre os
      // direitos do Dolibarr) e isAdmin reflete o próprio alvo. Enquanto os rights não chegam,
      // ou para grupo, cai em base=true (mostra tudo menos o ocultado por override).
      const targetIsAdmin = previewTarget.admin === 1 || previewTarget.admin === '1' || (previewTarget.admin as unknown) === true;
      let base = true;
      // Usuário OU grupo com rights carregados: base = acesso REAL (rights do Dolibarr / do grupo).
      if (previewTarget.rights) {
        base = computeBaseAccess(module, { admin: targetIsAdmin ? 1 : 0, rights: previewTarget.rights, id: previewTarget.id } as unknown as DolibarrUser);
      }
      return resolveScreenAccess({
        screenId: module,
        base,
        isAdmin: targetIsAdmin,
        userId: previewTarget.type === 'user' ? previewTarget.id : undefined,
        groupIds: previewTarget.groupIds,
        perms: orgScreenPerms,
      });
    }
    const base = computeBaseAccess(module, currentUser);
    return resolveScreenAccess({
      screenId: module,
      base,
      isAdmin: currentUser.admin === 1,
      userId: currentUser.id,
      groupIds: userGroupIds,
      perms: orgScreenPerms,
    });
  }, [config, currentUser, userGroupIds, orgScreenPerms, computeBaseAccess, previewTarget]);

  // FAZER (#540) — pode executar a ação na tela? Gateia botões pelos direitos de ESCRITA do
  // Dolibarr (creer = criar/editar, supprimer = excluir, valider = validar). Preview-aware:
  // usa o alvo do "ver como". Default SEGURO: tela/ação sem mapeamento NÃO é bloqueada.
  // A resolução do mapa WRITE está em src/utils/writePermissions.ts (pura, testável).
  const canDo = useCallback((action: 'create' | 'edit' | 'delete' | 'validate' | 'pay' | 'approve' | 'receive' | 'close' | 'reopen', screen: string): boolean => {
    if (!config) return false;
    const inPreview = !!previewTarget && !!previewTarget.rights; // usuário OU grupo com rights carregados
    const ident: any = inPreview ? { admin: previewTarget!.admin, rights: previewTarget!.rights } : currentUser;
    return canDoAction(ident, screen, action);
  }, [config, currentUser, previewTarget]);

  // 2. Data Hook (Reduced to Sync & Utility)
  const {
    isLoading, isSyncing, error, refreshData
  } = useDolibarrData({ config, canAccess, isSyncPaused });

  // 2b. #112 — carrega overrides de tela (org) e grupos do usuário p/ o canAccess.
  useEffect(() => {
    let cancelled = false;
    if (!config || !currentUser) {
      setOrgScreenPerms(null);
      setUserGroupIds([]);
      return;
    }
    // Overrides org-wide (vale p/ todos; admin ignora no resolver, mas carrega sem custo).
    getUiConfig()
      .then((cfg) => { if (!cancelled && cfg?.screenPermissions) setOrgScreenPerms(cfg.screenPermissions); })
      .catch(() => { /* mantém null = sem override */ });
    // Grupos do usuário (não precisa p/ admin, que tem bypass).
    if (currentUser.admin === 1) {
      setUserGroupIds([]);
    } else {
      DolibarrService.getUserGroups(config, currentUser.id)
        .then((groups: { id: string }[]) => { if (!cancelled) setUserGroupIds((groups || []).map((g) => String(g.id))); })
        .catch(() => { if (!cancelled) setUserGroupIds([]); });
    }
    return () => { cancelled = true; };
  }, [config, currentUser]);

  // 3b. Effect to bubble up hook errors to notifications
  useEffect(() => {
    if (error) {
      setNotifications(prev => [{
        id: String(Date.now()), title: 'Sync Error', message: error,
        type: 'info', priority: 'high', read: false, date: Date.now()
      }, ...prev]);
    }
  }, [error]);

  // Background sync flag and abort controller
  const hasRunBackgroundSync = useRef(false);
  const syncAbortRef = useRef<AbortController | null>(null);

  // 4. Config & User Loading Logic (Existing)
  useEffect(() => {
    const loadConfig = async () => {
      const savedConfigObj: any = safeStorage.getJSON('coolgroove_config', {});

      if (Object.keys(savedConfigObj).length > 0) {
        try {
          const parsed = savedConfigObj;

          if (!parsed.apiKey || parsed.apiKey.trim() === '') {
            log.warn('Invalid config. Resetting.');
            safeStorage.removeItem('coolgroove_config');
          } else {
            // Load User from Cache
            if (parsed.currentUser) {
              // Determine if we need to force refresh rights OU o status de admin.
              // Antes só re-buscava quando faltava `rights` — então um currentUser em cache SEM
              // `admin` ficava não-admin pra sempre, escondendo toda a UI admin (Merge/Iniciar/etc.)
              // mesmo pra quem É admin no Dolibarr. Agora também re-busca quando `admin` está ausente.
              if (!parsed.currentUser.rights || parsed.currentUser.admin === undefined || parsed.currentUser.admin === null) {
                try { // Synchronous refetch attempt
                  const freshUser = await DolibarrService.fetchCurrentUser(parsed, parsed.currentUser.login);
                  if (freshUser) {
                    parsed.currentUser = normalizeUser(freshUser); // admin coerido p/ número (evita "1" string)
                    safeStorage.setJSON('coolgroove_config', parsed);
                  }
                } catch (e) { log.error('User refresh failed', e); }
              }
              setCurrentUser(normalizeUser(parsed.currentUser));
            }

            setConfigState(parsed);

            // Background User Refresh
            DolibarrService.fetchCurrentUser(parsed, parsed.currentUser?.login).then(u => {
              if (u) {
                const normalized = normalizeUser(u);
                setCurrentUser(normalized);
                // Persiste o usuário NORMALIZADO em config.currentUser (admin número), senão o
                // refresh sobrescrevia com cru (admin:"1") e quebrava isAdmin no Dashboard/Header.
                const updated = { ...parsed, currentUser: normalized };
                setConfigState(updated);
                safeStorage.setJSON('coolgroove_config', updated);
              }
            }).catch(err => log.warn('Background user refresh failed', err));

            // Run Background Sync (once per session)
            if (!hasRunBackgroundSync.current) {
              hasRunBackgroundSync.current = true;
              syncAbortRef.current?.abort();
              syncAbortRef.current = new AbortController();
              log.debug('Starting background sync for all modules...');
              runBackgroundSync(parsed, syncAbortRef.current.signal).then(result => {
                log.debug(`Background sync complete: ${result.synced} records synced`);
                if (result.errors.length > 0) {
                  log.warn('Background sync errors', result.errors);
                }
                // Process notifications (now handled by backend NotificationService)
                if (result.synced > 0) {
                  refreshDataRef.current?.();
                }
              }).catch(err => {
                log.error('Background sync failed', err);
              });
            }
          }
        } catch (e) {
          log.error('Failed to parse saved config', e);
          safeStorage.removeItem('coolgroove_config');
        }
      }
      setIsInitialized(true);
    };
    loadConfig();
  }, []);


  // 5. Config Persistence & Dark Mode
  useEffect(() => {
    if (config) {
      document.documentElement.classList.toggle('dark', config.darkMode);
      safeStorage.setJSON('coolgroove_config', config);
    }
  }, [config]);

  // 6. Auto-Sync Interval
  // Use refs to avoid recreating the interval when callbacks change
  const refreshDataRef = useRef(refreshData);
  const configRef = useRef(config);
  const syncStateRef = useRef({ isSyncPaused, isLoading, isSyncing });

  // Keep refs updated
  useEffect(() => {
    refreshDataRef.current = refreshData;
    configRef.current = config;
    syncStateRef.current = { isSyncPaused, isLoading, isSyncing };
  }, [refreshData, config, isSyncPaused, isLoading, isSyncing]);

  useEffect(() => {
    if (!config?.autoSyncInterval || config.autoSyncInterval <= 0) return;

    const intervalId = setInterval(() => {
      const { isSyncPaused, isLoading, isSyncing } = syncStateRef.current;
      const currentConfig = configRef.current;

      if (!isSyncPaused && !isLoading && !isSyncing && currentConfig) {
        if (process.env.NODE_ENV !== 'production') {
          log.debug('AutoSync triggering background sync...');
        }
        // Call global background sync to ensure DB is updated
        runBackgroundSync(currentConfig).then((result) => {
          if (result.synced > 0) {
            refreshDataRef.current?.();
          }
        }).catch((err) => {
          log.error('AutoSync background sync failed', err);
        });
      }
    }, config.autoSyncInterval * 60 * 1000);

    return () => clearInterval(intervalId);
  }, [config?.autoSyncInterval]); // Only recreate interval when interval value changes

  const toggleSyncPause = useCallback(() => setIsSyncPaused(prev => !prev), []);

  const setConfig = useCallback((newConfig: DolibarrConfig | null) => {
    setConfigState(newConfig);
    if (newConfig) {
      if (newConfig.currentUser) {
        setCurrentUser(normalizeUser(newConfig.currentUser));
      }
      // Trigger background sync on new config (login)
      if (!hasRunBackgroundSync.current) {
        hasRunBackgroundSync.current = true;
        syncAbortRef.current?.abort();
        syncAbortRef.current = new AbortController();
        log.debug('Starting background sync for all modules (on login)...');
        runBackgroundSync(newConfig, syncAbortRef.current.signal).then(result => {
          log.debug(`Background sync complete: ${result.synced} records synced`);
          if (result.errors.length > 0) {
            log.warn('Background sync errors', result.errors);
          }
        }).catch(err => {
          log.error('Background sync failed', err);
        });
      }
    } else {
      syncAbortRef.current?.abort(); // Cancel any running sync
      safeStorage.removeItem('coolgroove_config');
      dbService.clearAll().catch(err => log.error('Failed to clear DB', err));
      setCurrentUser(null);
      hasRunBackgroundSync.current = false; // Reset on logout
    }
  }, []);

  const logout = useCallback(() => {
    setConfig(null);
  }, [setConfig]);

  // Re-busca os direitos do usuário logado (após editar as permissões dele) — mantém canAccess/canDo
  // coerentes sem precisar relogar.
  const refreshCurrentUser = useCallback(async () => {
    const login = currentUser?.login || config?.currentUser?.login;
    if (!config || !login) return;
    try {
      const u = await DolibarrService.fetchCurrentUser(config, login);
      if (u) setCurrentUser(normalizeUser(u));
    } catch (e) {
      log.warn('refreshCurrentUser falhou', e);
    }
  }, [config, currentUser]);

  // Re-resolve os direitos do alvo do "Ver como" após uma edição (as stores já foram limpas pela
  // invalidação → getGroupRights/getUserById retornam fresco).
  const refreshPreviewTarget = useCallback(async () => {
    if (!config || !previewTarget) return;
    try {
      if (previewTarget.type === 'group') {
        const rights = await DolibarrService.getGroupRights(config, previewTarget.id);
        setPreviewTarget({ ...previewTarget, rights: rights || {} });
      } else {
        const u = await DolibarrService.getUserById(config, previewTarget.id);
        if (u) setPreviewTarget({ ...previewTarget, rights: (u as any).rights, admin: (u as any).admin });
      }
    } catch (e) {
      log.warn('refreshPreviewTarget falhou', e);
    }
  }, [config, previewTarget]);

  const contextValue = useMemo(() => ({
    config, setConfig,
    currentUser, canAccess, canDo, logout,
    isLoading, error, isSyncing, isSyncPaused, toggleSyncPause,
    notifications, setNotifications,
    refreshData,
    isInitialized,
    previewTarget, setPreviewTarget,
    orgScreenPerms, userGroupIds,
    refreshCurrentUser, refreshPreviewTarget,
  }), [
    config, setConfig, currentUser, canAccess, canDo, logout,
    isLoading, error, isSyncing, isSyncPaused, toggleSyncPause,
    notifications, refreshData, isInitialized,
    previewTarget, orgScreenPerms, userGroupIds,
    refreshCurrentUser, refreshPreviewTarget,
  ]);


  return (
    <DolibarrContext.Provider value={contextValue}>
      {children}
    </DolibarrContext.Provider>
  );
};

export const useDolibarr = () => {
  const context = useContext(DolibarrContext);
  if (context === undefined) {
    throw new Error('useDolibarr must be used within a DolibarrProvider');
  }
  return context;
};
