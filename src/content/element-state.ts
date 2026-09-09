export function isElementDisabled(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') {
    return true;
  }
  return element.matches(':disabled');
}

export function isElementVisible(element: HTMLElement, rect = element.getBoundingClientRect()): boolean {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') {
    return false;
  }
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') {
    return false;
  }
  return rect.width > 0 && rect.height > 0;
}
