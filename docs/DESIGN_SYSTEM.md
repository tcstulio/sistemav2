# Sistema de Design - CoolGroove

Guia de padrões visuais e componentes reutilizáveis.

## Componentes Base

### PageLayout
Container padrão para páginas com scroll correto.

```tsx
import { PageLayout } from '../components/ui';

<PageLayout title="Produtos" maxWidth="xl">
  {/* conteúdo */}
</PageLayout>
```

**Props:** `title`, `maxWidth` (sm|md|lg|xl|2xl|full), `noPadding`, `className`

---

### Card
Card padronizado com header/footer opcionais.

```tsx
import { Card } from '../components/ui';

<Card header={<h3>Título</h3>} padding="md" hoverable>
  Conteúdo do card
</Card>
```

**Props:** `header`, `footer`, `padding` (none|sm|md|lg), `onClick`, `selected`, `hoverable`

---

### Button
Botão com variantes e estado de loading.

```tsx
import { Button } from '../components/ui';
import { Plus } from 'lucide-react';

<Button variant="primary" icon={<Plus size={16} />} loading={isLoading}>
  Criar Novo
</Button>
```

**Variants:** `primary`, `secondary`, `danger`, `ghost`, `outline`
**Sizes:** `sm`, `md`, `lg`

---

### Input
Input com label, erro e ícones.

```tsx
import { Input } from '../components/ui';
import { Mail } from 'lucide-react';

<Input 
  label="Email" 
  type="email"
  icon={<Mail size={16} />}
  error={errors.email}
/>
```

---

### Modal
Modal com header/footer fixos e conteúdo rolável.

```tsx
import { Modal, Button } from '../components/ui';

<Modal 
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Editar"
  footer={<Button onClick={save}>Salvar</Button>}
>
  <form>...</form>
</Modal>
```

---

## Temas de Cor

Classes disponíveis no `<html>` ou container raiz:

| Classe | Cor Primária |
|--------|--------------|
| `theme-indigo` | Índigo (padrão) |
| `theme-emerald` | Verde |
| `theme-blue` | Azul |
| `theme-violet` | Violeta |
| `theme-rose` | Rosa |

**Dark Mode:** Adicione classe `dark` no `<html>`.

---

## CSS Variables Principais

```css
--color-primary          /* Cor primária RGB */
--color-primary-hover    /* Cor primária hover RGB */
--spacing-page           /* Padding padrão de página */
--radius-lg              /* Border radius padrão */
--shadow-card            /* Sombra de cards */
```

Ver arquivo completo: `src/styles/design-tokens.css`
