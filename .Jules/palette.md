## 2026-01-28 - Accessibility Patterns in Task Detail & Chat
**Learning:** Found a consistent pattern of icon-only buttons (Back, Settings, Edit, Reply) missing `aria-label` attributes in `TaskDetail` and `ChatInterface` components. Also, form inputs in custom modals lack `id`/`htmlFor` associations.
**Action:** When working on "Detail" or "List" components, prioritize checking icon-only buttons and modal forms for basic accessibility compliance.
