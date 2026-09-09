const CURSOR_ATTRIBUTE = 'data-browser-control-agent-cursor';

export class AgentCursor {
  private cursor: HTMLDivElement | null = null;

  public constructor(private readonly pageDocument: Document) {}

  public show(x: number, y: number): void {
    const cursor = this.getOrCreate();
    cursor.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    cursor.style.opacity = '1';
    cursor.animate(
      [
        { scale: '0.8', opacity: 0.65 },
        { scale: '1', opacity: 1 },
      ],
      { duration: 140, easing: 'ease-out' },
    );
  }

  public showForElement(element: HTMLElement): void {
    const bounds = element.getBoundingClientRect();
    this.show(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  }

  private getOrCreate(): HTMLDivElement {
    if (this.cursor?.isConnected) return this.cursor;
    const cursor = this.pageDocument.createElement('div');
    cursor.setAttribute(CURSOR_ATTRIBUTE, 'true');
    cursor.setAttribute('aria-hidden', 'true');
    cursor.textContent = 'AI';
    Object.assign(cursor.style, {
      position: 'fixed',
      top: '-14px',
      left: '-14px',
      width: '28px',
      height: '28px',
      border: '2px solid #ffffff',
      borderRadius: '50%',
      background: '#1769e0',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.35)',
      color: '#ffffff',
      font: '700 10px/24px system-ui, sans-serif',
      letterSpacing: '0',
      textAlign: 'center',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'transform 120ms ease-out, opacity 120ms ease-out',
      zIndex: '2147483647',
    } satisfies Partial<CSSStyleDeclaration>);
    (this.pageDocument.documentElement ?? this.pageDocument.body).append(cursor);
    this.cursor = cursor;
    return cursor;
  }
}
