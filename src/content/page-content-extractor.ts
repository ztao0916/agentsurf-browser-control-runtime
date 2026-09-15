export interface ExtractedPageContent {
  url: string;
  title: string;
  text: string;
  html?: string;
  images: Array<{ src: string; alt: string; width: number; height: number; visible: boolean; in_viewport: boolean }>;
  frames: Array<{ src: string; name: string; title: string; visible: boolean; in_viewport: boolean }>;
}

const isVisible = (element: Element) => {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
};

const inViewport = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
};

export function extractPageContent(document: Document, includeHtml = false, includeImages = true, includeFrames = true, maxTextLength = 50_000): ExtractedPageContent {
  const clone = document.body?.cloneNode(true) as HTMLElement | null;
  clone?.querySelectorAll('script,style,noscript,template').forEach((node) => node.remove());
  const textParts = [clone?.innerText || clone?.textContent || ''];
  const images: ExtractedPageContent['images'] = [];
  const frames: ExtractedPageContent['frames'] = [];

  const collect = (root: Document | ShadowRoot | Element) => {
    root.querySelectorAll('img').forEach((image) => {
      const src = image.currentSrc || image.src || image.dataset.src || image.dataset.original || '';
      if (src) images.push({ src, alt: image.alt || image.title || '', width: image.naturalWidth || image.width, height: image.naturalHeight || image.height, visible: isVisible(image), in_viewport: inViewport(image) });
    });
    root.querySelectorAll('iframe').forEach((frame) => frames.push({ src: frame.src, name: frame.name, title: frame.title, visible: isVisible(frame), in_viewport: inViewport(frame) }));
    root.querySelectorAll('*').forEach((element) => {
      if (element.shadowRoot) {
        textParts.push(element.shadowRoot.textContent || '');
        collect(element.shadowRoot);
      }
    });
  };
  collect(document);
  const uniqueImages = [...new Map(images.map((image) => [image.src, image])).values()];
  const uniqueFrames = [...new Map(frames.map((frame) => [`${frame.src}|${frame.name}`, frame])).values()];
  const text = textParts.join(' ').replace(/\s+/g, ' ').trim().slice(0, maxTextLength);
  return { url: document.location.href, title: document.title, text, ...(includeHtml ? { html: clone?.outerHTML.slice(0, maxTextLength * 2) || '' } : {}), images: includeImages ? uniqueImages : [], frames: includeFrames ? uniqueFrames : [] };
}
