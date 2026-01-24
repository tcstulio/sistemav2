---
description: Refatorar componente para usar Design System UI
---

# Workflow: Refatorar para Design System

## Pré-requisitos
- Componentes UI disponíveis em `src/components/ui/`
- Design tokens em `src/styles/design-tokens.css`

## Passos

### 1. Importar componentes do Design System
```tsx
import { 
    PageLayout, 
    PageHeader, 
    MasterDetailLayout, 
    Card, 
    Button, 
    Input, 
    Modal, 
    Tabs, 
    Tab,
    EmptyState 
} from './ui';
```

### 2. Substituir Header inline por PageHeader
**Antes:**
```tsx
<div className="p-4 md:p-6 bg-white...">
    <h2>Título</h2>
    <button>Novo</button>
</div>
```

**Depois:**
```tsx
<PageHeader
    title="Título"
    subtitle="Descrição"
    actions={<Button icon={<Plus />}>Novo</Button>}
    tabs={<Tabs value={tab} onChange={setTab}>...</Tabs>}
/>
```

### 3. Substituir layout lista/detalhe por MasterDetailLayout
**Antes:**
```tsx
<div className="flex-1 min-h-0 flex overflow-hidden">
    <div className={`... ${selected ? 'hidden lg:block' : ''}`}>
        {/* lista */}
    </div>
    <div className={`... ${selected ? 'block' : 'hidden'}`}>
        {/* detalhe */}
    </div>
</div>
```

**Depois:**
```tsx
<MasterDetailLayout
    showDetail={!!selected}
    onCloseDetail={() => setSelected(null)}
    listWidth="1/3"
    list={<Lista />}
    detail={selected && <Detalhe />}
/>
```

### 4. Substituir modais inline por Modal
**Antes:**
```tsx
{isOpen && (
    <div className="fixed inset-0 z-50 bg-black/50...">
        <div className="bg-white rounded-xl...">
            <div className="p-4 border-b...">
                <h3>Título</h3>
                <button onClick={close}><X /></button>
            </div>
            <div className="p-6">...</div>
        </div>
    </div>
)}
```

**Depois:**
```tsx
<Modal
    isOpen={isOpen}
    onClose={close}
    title="Título"
    size="md"
    footer={<Button onClick={save}>Salvar</Button>}
>
    {/* conteúdo */}
</Modal>
```

### 5. Substituir estados vazios por EmptyState
**Antes:**
```tsx
<div className="text-center py-20 text-slate-400">
    <Package size={48} className="mx-auto mb-4 opacity-50" />
    <p>Nenhum item encontrado.</p>
</div>
```

**Depois:**
```tsx
<EmptyState
    icon={Package}
    title="Nenhum item encontrado"
    description="Tente ajustar os filtros."
    action={<Button>Adicionar</Button>}
/>
```

### 6. Substituir botões inline por Button
**Antes:**
```tsx
<button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg...">
    {loading ? <Loader2 className="animate-spin" /> : <Plus />} Novo
</button>
```

**Depois:**
```tsx
<Button variant="primary" icon={<Plus />} loading={loading}>
    Novo
</Button>
```

### 7. Substituir inputs inline por Input
**Antes:**
```tsx
<label>Nome</label>
<input className="w-full p-2 border rounded-lg..." value={value} onChange={...} />
```

**Depois:**
```tsx
<Input label="Nome" value={value} onChange={...} error={errors.name} />
```

### 8. Verificar
// turbo
```bash
npx tsc --noEmit
```

## Modelo de Referência
Ver `src/components/ProductList.tsx` como exemplo completo.
