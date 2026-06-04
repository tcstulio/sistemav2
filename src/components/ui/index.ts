// Design System UI Components
// Barrel export for easy imports

// Layout Components
export { PageLayout } from './PageLayout';
export { PageHeader } from './PageHeader';
export { MasterDetailLayout } from './MasterDetailLayout';

// Display Components
export { Card } from './Card';
export { EmptyState } from './EmptyState';

// Form Components
export { Button } from './Button';
export { Input } from './Input';
export { RichTextEditor } from './RichTextEditor';

// Navigation Components
export { Tabs, Tab } from './Tabs';
export { Breadcrumbs, usePageTitle } from './Breadcrumbs';

// Feedback Components
export { Spinner, LoadingOverlay, LoadingCard, LoadingButton, Skeleton, SkeletonText, SkeletonCard, SkeletonTableRow, ErrorState } from './LoadingStates';

// Overlay Components
export { Modal } from './Modal';
export { ConfirmModal } from './ConfirmModal';

// Data Display
export { StatusBadge } from './StatusBadge';
export type { StatusConfig, BadgeVariant } from './StatusBadge';

// Usage:
// import { PageLayout, PageHeader, Card, Button, Input, Modal } from '../components/ui';
