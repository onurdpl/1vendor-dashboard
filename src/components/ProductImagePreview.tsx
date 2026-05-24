import { useEffect, useRef, useState } from 'react';

type ProductImagePreviewState = {
  src: string;
  alt: string;
  title: string;
  subtitle: string;
  top: number;
  left: number;
};

type ProductImagePreviewProps = {
  imageUrl?: string | null;
  fallbackLabel: string;
  alt: string;
  title: string;
  subtitle?: string | null;
  size?: 'detail' | 'compact' | 'sidebar';
};

function buildPreviewState(
  src: string,
  alt: string,
  title: string,
  subtitle: string,
  element: HTMLElement,
): ProductImagePreviewState {
  const previewWidth = 248;
  const previewHeight = 278;
  const viewportWidth = window.innerWidth || 1024;
  const viewportHeight = window.innerHeight || 768;
  const rect = element.getBoundingClientRect();
  const preferredLeft = rect.right + 12;
  const fallbackLeft = rect.left - previewWidth - 12;
  const left = Math.max(
    12,
    Math.min(
      preferredLeft + previewWidth + 12 <= viewportWidth ? preferredLeft : fallbackLeft,
      viewportWidth - previewWidth - 12,
    ),
  );
  const top = Math.max(12, Math.min(rect.top + rect.height / 2 - previewHeight / 2, viewportHeight - previewHeight - 12));

  return { src, alt, title, subtitle, top, left };
}

export function ProductImagePreview({
  imageUrl,
  fallbackLabel,
  alt,
  title,
  subtitle,
  size = 'detail',
}: ProductImagePreviewProps) {
  const src = imageUrl?.trim() ?? '';
  const previewSubtitle = subtitle?.trim() ?? '';
  const [failed, setFailed] = useState(false);
  const [hoveredPreview, setHoveredPreview] = useState<ProductImagePreviewState | null>(null);
  const [activePreview, setActivePreview] = useState<ProductImagePreviewState | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const hasUsableImage = Boolean(src && !failed);
  const thumbnailClassName = `order-item-thumb product-image-preview-thumb product-image-preview-thumb-${size}`;

  useEffect(() => {
    setFailed(false);
    setHoveredPreview(null);
    setActivePreview(null);
  }, [src]);

  useEffect(() => {
    if (!activePreview) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActivePreview(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activePreview]);

  useEffect(() => {
    if (activePreview) {
      closeButtonRef.current?.focus();
    }
  }, [activePreview]);

  function showPreview(element: HTMLElement) {
    if (hasUsableImage) {
      setHoveredPreview(buildPreviewState(src, alt, title, previewSubtitle, element));
    }
  }

  function openPreview(element: HTMLElement) {
    if (hasUsableImage) {
      setActivePreview(buildPreviewState(src, alt, title, previewSubtitle, element));
      setHoveredPreview(null);
    }
  }

  return (
    <>
      {hasUsableImage ? (
        <button
          type="button"
          className={`${thumbnailClassName} order-item-thumb-button`}
          aria-label={`Preview ${title || 'product image'}`}
          onMouseEnter={(event) => showPreview(event.currentTarget)}
          onMouseLeave={() => setHoveredPreview(null)}
          onFocus={(event) => showPreview(event.currentTarget)}
          onBlur={() => setHoveredPreview(null)}
          onClick={(event) => openPreview(event.currentTarget)}
        >
          <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
          <span className="order-item-thumb-fallback">{fallbackLabel}</span>
        </button>
      ) : (
        <span className={thumbnailClassName} aria-hidden="true">
          <span className="order-item-thumb-fallback">{fallbackLabel}</span>
        </span>
      )}

      {hoveredPreview ? (
        <div
          className="line-item-image-hover-preview"
          style={{ top: hoveredPreview.top, left: hoveredPreview.left }}
          aria-hidden="true"
        >
          <img src={hoveredPreview.src} alt="" />
          <span>{hoveredPreview.title}</span>
          {hoveredPreview.subtitle ? <small>{hoveredPreview.subtitle}</small> : null}
        </div>
      ) : null}

      {activePreview ? (
        <div
          className="line-item-image-lightbox-backdrop"
          role="presentation"
          onMouseDown={() => setActivePreview(null)}
        >
          <div
            className="line-item-image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={`${activePreview.title} image preview`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="line-item-image-lightbox-close"
              aria-label="Close image preview"
              ref={closeButtonRef}
              onClick={() => setActivePreview(null)}
            >
              ×
            </button>
            <div className="line-item-image-lightbox-canvas">
              <img src={activePreview.src} alt={activePreview.alt} />
            </div>
            <footer className="line-item-image-lightbox-footer">
              <p>{activePreview.title}</p>
              {activePreview.subtitle ? <span>{activePreview.subtitle}</span> : null}
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
