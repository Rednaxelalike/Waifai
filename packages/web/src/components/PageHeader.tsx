import type { ReactNode } from 'react';

/**
 * Page title, and the one control that belongs beside it.
 *
 * There used to be an icon badge and a subtitle here. Both went: the icon
 * repeated the tab bar directly below it, and the subtitle restated the title
 * in longer words on every single page.
 */
export function PageHeader({
  title,
  action,
}: {
  title: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {action}
    </div>
  );
}
