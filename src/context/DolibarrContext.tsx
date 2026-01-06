import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useMemo, useRef } from 'react';
import { DolibarrConfig, ThirdParty, Invoice, Product, Proposal, Order, Project, Task, BankAccount, BankLine, AgendaEvent, DolibarrUser, SupplierInvoice, SupplierOrder, Ticket, Warehouse, StockMovement, Intervention, ExpenseReport, RecruitmentJobPosition, Candidate, LeaveRequest, Contract, ManufacturingOrder, BOM, Shipment, Contact, AppNotification, DolibarrModule } from '../types';
import { DolibarrService } from '../services/dolibarrService';
import { dbService } from '../services/dbService';
import { WhatsAppService } from '../services/whatsappService';
import { AutomationService } from '../services/automationService';
import { useDolibarrData } from '../hooks/useDolibarrData';
import { runBackgroundSync } from '../services/backgroundSyncService';

interface DolibarrContextType {
  config: DolibarrConfig | null;
  setConfig: (config: DolibarrConfig | null) => void;
  isLoading: boolean;
  notifications: AppNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>;
  refreshData: (options?: { forceFull?: boolean, limit?: number, page?: number, query?: string }) => Promise<void>;
  isSyncPaused: boolean;
  toggleSyncPause: () => void;
  isSyncing: boolean;
  currentUser?: DolibarrUser | null;
  canAccess: (module: string) => boolean;
  logout: () => void;
  isInitialized: boolean;
}

const DolibarrContext = createContext<DolibarrContextType | undefined>(undefined);

export const DolibarrProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [config, setConfigState] = useState<DolibarrConfig | null>(null);
  const [isSyncPaused, setIsSyncPaused] = useState(false);
  const [currentUser, setCurrentUser] = useState<DolibarrUser | null>(null);
  // 1. Load notifications from local storage
  const [notifications, setNotifications] = useState<AppNotification[]>(() => {
    try {
      const saved = localStorage.getItem('coolgroove_notifications');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });
  const [isInitialized, setIsInitialized] = useState(false);

  // 1. Permission Logic (Must be defined before data hook)
  const canAccess = useCallback((module: string): boolean => {
    if (!config) return false;
    if (!currentUser) return false;
    // 0. Public Modules (Accessible to everyone)
    if (module === 'dashboard') return true;

    // 1. Admin Override (Robust check for loose API types)
    if (currentUser.admin === 1 || currentUser.admin === '1' || currentUser.admin === true) return true;

    if (!currentUser.rights) {
      return false;
    }

    const rightsMap: Record<string, { module: string, perms: string[] }> = {
      // CRM
      'customers': { module: 'societe', perms: ['lire', 'read', 'client.voir'] },
      'suppliers': { module: 'fournisseur', perms: ['lire', 'read', 'facture.lire'] },
      'contacts': { module: 'contact', perms: ['lire', 'read'] },

      // Sales / Finance
      'proposals': { module: 'propale', perms: ['lire', 'read'] },
      'orders': { module: 'commande', perms: ['lire', 'read'] },
      'invoices': { module: 'facture', perms: ['lire', 'read'] },
      'payments': { module: 'facture', perms: ['lire', 'read'] },
      'contracts': { module: 'contrat', perms: ['lire', 'read'] },
      'supplier_orders': { module: 'fournisseur', perms: ['commande.lire'] },
      'supplier_invoices': { module: 'fournisseur', perms: ['facture.lire'] },

      // Projects / Operations
      'projects': { module: 'projet', perms: ['lire', 'read'] },
      'tasks': { module: 'projet', perms: ['lire', 'read'] },
      'interventions': { module: 'ficheinter', perms: ['lire', 'read'] },
      'agenda': { module: 'agenda', perms: ['myevent.read', 'allactions.read'] },

      // Stock / Product
      'products': { module: 'produit', perms: ['lire', 'read'] },
      'services': { module: 'service', perms: ['lire', 'read'] },
      'inventory': { module: 'stock', perms: ['lire', 'read'] },
      'shipments': { module: 'expedition', perms: ['lire', 'read'] },
      'warehouses': { module: 'stock', perms: ['lire', 'read'] },
      'movements': { module: 'stock', perms: ['mouvement.lire'] },
      'manufacturing': { module: 'mrp', perms: ['read', 'lire'] },
      'boms': { module: 'bom', perms: ['read', 'lire'] },

      // HR / Admin
      'users': { module: 'user', perms: ['user.lire', 'user.read', 'self.read'] },
      'hr': { module: 'holiday', perms: ['read', 'lire'] },
      'tickets': { module: 'ticket', perms: ['read', 'lire'] },
      'bank_accounts': { module: 'banque', perms: ['lire', 'read'] },
      'categories': { module: 'categorie', perms: ['lire', 'read'] },
    };

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
  }, [config, currentUser]);

  // 2. Data Hook (Reduced to Sync & Utility)
  const {
    isLoading, isSyncing, error, refreshData
  } = useDolibarrData({ config, canAccess, isSyncPaused });

  // 3. Persistence for notifications
  useEffect(() => {
    localStorage.setItem('coolgroove_notifications', JSON.stringify(notifications));
  }, [notifications]);

  // 3b. Effect to bubble up hook errors to notifications
  useEffect(() => {
    if (error) {
      setNotifications(prev => [{
        id: String(Date.now()), title: 'Sync Error', message: error,
        type: 'info', priority: 'high', read: false, date: Date.now()
      }, ...prev]);
    }
  }, [error]);

  // Removed direct WA sending in favor of AutomationService


  // Helper to process sync changes for notifications
  const processSyncChanges = useCallback((changes: Record<string, any[]>) => {
    if (!currentUser) return;

    const newNotes: AppNotification[] = [];
    const now = Date.now();
    const automationTriggers: { context: any }[] = [];

    // Check Tasks
    if (changes.tasks && changes.tasks.length > 0) {
      changes.tasks.forEach((task: Task) => {
        // Only interested if assigned to me or created by me (if I care about updates)
        // Focusing on assignments to me
        if (task.fk_user_assign === currentUser.id || task.fk_user_assign === currentUser.login) {
          // Determine type
          const isNew = Math.abs((task.date_modification || 0) - (task.date_creation || 0)) < 600; // Created within last 10 mins of update
          const isDone = Number(task.progress) === 100;
          // Spam prevention: Ignore items older than 48h
          if ((now - (task.date_modification || 0)) > 48 * 60 * 60 * 1000) return;

          // Duplicate check (simple) - if we already have a unread notification for this ID
          const exists = notifications.some(n => n.linkTo?.id === task.id && !n.read);
          if (exists) return;

          if (isDone) {
            // Maybe don't notify me if I finished it? Only if someone else finished it?
            // Skip completion for now to avoid self-spam
          } else if (isNew) {
            newNotes.push({
              id: `task-${task.id}-${now}`,
              type: 'info',
              priority: 'medium',
              title: 'Nova Tarefa Atribuída',
              message: `${task.ref} - ${task.label}`,
              date: now,
              read: false,
              linkTo: { view: 'tasks', id: task.id }
            });
            automationTriggers.push({
              context: {
                title: 'Nova Tarefa Atribuída',
                message: `${task.ref} - ${task.label}`,
                type: 'task',
                user_phone: currentUser.phone_mobile,
                user_email: currentUser.email,
                ref: task.ref,
                label: task.label
              }
            });
          } else {
            // Update
            // Optional: Uncomment to enable update notifications
            /*
            newNotes.push({
                id: `task-upt-${task.id}-${now}`,
                type: 'info',
                priority: 'low',
                title: 'Tarefa Atualizada',
                message: `${task.ref} - ${task.label}`,
                date: now,
                read: false,
                linkTo: { view: 'tasks', id: task.id }
            });
            */
          }
        }
      });
    }

    // Check Events (Agenda)
    if (changes.events && changes.events.length > 0) {
      changes.events.forEach((evt: AgendaEvent) => {
        // Check assignee (user_assigned holds ID)
        if (evt.user_assigned === currentUser.id || evt.user_assigned === currentUser.login) {
          // Spam prevention
          if ((now - (evt.date_modification || 0)) > 48 * 60 * 60 * 1000) return;

          const isNew = Math.abs((evt.date_modification || 0) - (evt.date_c || 0)) < 600;
          if (isNew) {
            newNotes.push({
              id: `evt-${evt.id}-${now}`,
              type: 'info',
              priority: 'medium',
              title: 'Novo Evento na Agenda',
              message: `${evt.label} (${new Date((evt.date_start || 0)).toLocaleDateString()})`,
              date: now,
              read: false,
              linkTo: { view: 'agenda', id: evt.id }
            });
            automationTriggers.push({
              context: {
                title: 'Novo Evento',
                message: `${evt.label} em ${new Date((evt.date_start || 0)).toLocaleDateString()}`,
                type: 'event',
                user_phone: currentUser.phone_mobile,
                user_email: currentUser.email,
                label: evt.label
              }
            });
          }
        }
      });
    }

    // Check Tickets
    if (changes.tickets && changes.tickets.length > 0) {
      changes.tickets.forEach((tick: Ticket) => {
        if (tick.fk_user_assign === currentUser.id) {
          // Spam prevention
          if ((now - (tick.date_modification || 0)) > 48 * 60 * 60 * 1000) return;

          const isNew = Math.abs((tick.tms || 0) - (tick.datec || 0)) < 600;
          if (isNew) {
            newNotes.push({
              id: `tick-${tick.id}-${now}`,
              type: 'ticket',
              priority: 'high',
              title: 'Novo Ticket Atribuído',
              message: `${tick.ref} - ${tick.subject}`,
              date: now,
              read: false,
              linkTo: { view: 'tickets', id: tick.id }
            });
            automationTriggers.push({
              context: {
                title: 'Novo Chamado',
                message: `${tick.ref} - ${tick.subject}`,
                type: 'ticket',
                user_phone: currentUser.phone_mobile,
                user_email: currentUser.email,
                ref: tick.ref,
                subject: tick.subject
              }
            });
          }
        }
      });
    }

    if (newNotes.length > 0) {
      setNotifications(prev => [...newNotes, ...prev]);

      // Trigger Automations
      automationTriggers.forEach(trigger => {
        AutomationService.trigger('notification_created', trigger.context);
      });
    }
  }, [currentUser, notifications]);

  // Background sync flag
  const hasRunBackgroundSync = useRef(false);

  // 4. Config & User Loading Logic (Existing)
  useEffect(() => {
    const loadConfig = async () => {
      const savedConfigObj = JSON.parse(localStorage.getItem('coolgroove_config') || '{}');

      if (Object.keys(savedConfigObj).length > 0) {
        try {
          const parsed = savedConfigObj;

          if (!parsed.apiKey || parsed.apiKey.trim() === '') {
            console.warn("[DolibarrContext] Invalid config. Resetting.");
            localStorage.removeItem('coolgroove_config');
          } else {
            // Load User from Cache
            if (parsed.currentUser) {
              // Determine if we need to force refresh rights
              if (!parsed.currentUser.rights) {
                try { // Synchronous refetch attempt
                  const freshUser = await DolibarrService.fetchCurrentUser(parsed, parsed.currentUser.login);
                  if (freshUser) {
                    parsed.currentUser = freshUser;
                    localStorage.setItem('coolgroove_config', JSON.stringify(parsed));
                  }
                } catch (e) { console.error("User refresh failed", e); }
              }
              setCurrentUser(parsed.currentUser);
            }

            setConfigState(parsed);

            // Background User Refresh
            DolibarrService.fetchCurrentUser(parsed, parsed.currentUser?.login).then(u => {
              if (u) {
                setCurrentUser(u);
                const updated = { ...parsed, currentUser: u };
                setConfigState(updated);
                localStorage.setItem('coolgroove_config', JSON.stringify(updated));
              }
            }).catch(err => console.warn("Background user refresh failed", err));

            // Run Background Sync (once per session)
            if (!hasRunBackgroundSync.current) {
              hasRunBackgroundSync.current = true;
              console.log('[DolibarrContext] Starting background sync for all modules...');
              runBackgroundSync(parsed).then(result => {
                console.log(`[DolibarrContext] Background sync complete: ${result.synced} records synced`);
                if (result.errors.length > 0) {
                  console.warn('[DolibarrContext] Background sync errors:', result.errors);
                }
                // Process notifications
                processSyncChanges(result.changes);
              }).catch(err => {
                console.error('[DolibarrContext] Background sync failed:', err);
              });
            }
          }
        } catch (e) {
          console.error("Failed to parse saved config", e);
          localStorage.removeItem('doligen_config');
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
      localStorage.setItem('coolgroove_config', JSON.stringify(config));
    }
  }, [config]);

  // 6. Auto-Sync Interval
  useEffect(() => {
    if (!config?.autoSyncInterval || config.autoSyncInterval <= 0) return;
    const intervalId = setInterval(() => {
      if (!isSyncPaused && !isLoading && !isSyncing && config) {
        console.log("Auto-sync triggering...");
        // Call global background sync to ensure DB is updated
        runBackgroundSync(config).then((result) => {
          processSyncChanges(result.changes);
          // Then invalidate queries to refresh UI
          refreshData();
        });
      }
    }, config.autoSyncInterval * 60 * 1000);
    return () => clearInterval(intervalId);
  }, [config?.autoSyncInterval, isSyncPaused, isLoading, isSyncing, refreshData]);

  const toggleSyncPause = useCallback(() => setIsSyncPaused(prev => !prev), []);

  const setConfig = useCallback((newConfig: DolibarrConfig | null) => {
    setConfigState(newConfig);
    if (newConfig) {
      if (newConfig.currentUser) {
        setCurrentUser(newConfig.currentUser);
      }
      // Trigger background sync on new config (login)
      if (!hasRunBackgroundSync.current) {
        hasRunBackgroundSync.current = true;
        console.log('[DolibarrContext] Starting background sync for all modules (on login)...');
        runBackgroundSync(newConfig).then(result => {
          console.log(`[DolibarrContext] Background sync complete: ${result.synced} records synced`);
          if (result.errors.length > 0) {
            console.warn('[DolibarrContext] Background sync errors:', result.errors);
          }
          processSyncChanges(result.changes);
        }).catch(err => {
          console.error('[DolibarrContext] Background sync failed:', err);
        });
      }
    } else {
      localStorage.removeItem('coolgroove_config');
      dbService.clearAll().catch(console.error);
      setCurrentUser(null);
      hasRunBackgroundSync.current = false; // Reset on logout
    }
  }, []);

  const logout = useCallback(() => {
    setConfig(null);
  }, [setConfig]);

  const contextValue = useMemo(() => ({
    config, setConfig,
    currentUser, canAccess, logout,
    isLoading, isSyncing, isSyncPaused, toggleSyncPause,
    notifications, setNotifications,
    refreshData,
    isInitialized
  }), [
    config, setConfig, currentUser, canAccess, logout,
    isLoading, isSyncing, isSyncPaused, toggleSyncPause,
    notifications, refreshData, isInitialized
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
