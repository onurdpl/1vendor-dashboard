import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import type { VendorDirectoryItem } from '../lib/api/contracts';

export type VendorSelectorItem = Pick<VendorDirectoryItem, 'vendorId' | 'vendorName'>
  & Partial<Pick<VendorDirectoryItem, 'statusLabel'>>;

export type VendorSelectorProps = {
  variant: 'light' | 'dark';
  selectedVendorId: string | null;
  selectedVendor?: VendorSelectorItem | null;
  vendors: readonly VendorSelectorItem[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onSelectVendor: (vendorId: string) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  pageNumber?: number;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  pendingVerification?: boolean;
  disabled?: boolean;
  embedded?: boolean;
  onDismiss?: () => void;
};

export function VendorSelector({
  variant,
  selectedVendorId,
  selectedVendor,
  vendors,
  searchValue,
  onSearchChange,
  onSelectVendor,
  loading = false,
  error = null,
  onRetry,
  pageNumber,
  hasPrevious = false,
  hasNext = false,
  onPrevious,
  onNext,
  pendingVerification = false,
  disabled = false,
  embedded = false,
  onDismiss,
}: VendorSelectorProps) {
  const [open, setOpen] = useState(false);
  const [highlightedVendorId, setHighlightedVendorId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const unavailable = disabled || pendingVerification;
  const panelOpen = embedded || (open && !unavailable);
  const currentVendor = selectedVendor?.vendorId === selectedVendorId
    ? selectedVendor
    : vendors.find((vendor) => vendor.vendorId === selectedVendorId);
  const selectedName = selectedVendorId ? currentVendor?.vendorName ?? selectedVendorId : 'Select a Vendor';
  const highlightedIndex = vendors.findIndex((vendor) => vendor.vendorId === highlightedVendorId);

  useEffect(() => {
    if (panelOpen) searchRef.current?.focus();
  }, [panelOpen]);

  function closePanel(restoreFocus: boolean) {
    if (embedded) {
      onDismiss?.();
      return;
    }
    setOpen(false);
    setHighlightedVendorId(null);
    if (restoreFocus) triggerRef.current?.focus();
  }

  function selectVendor(vendorId: string) {
    if (unavailable || !vendors.some((vendor) => vendor.vendorId === vendorId)) return;
    onSelectVendor(vendorId);
    if (!embedded) closePanel(true);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!unavailable && !panelOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setOpen(true);
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (vendors.length === 0) return;
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = highlightedIndex < 0
        ? direction === 1 ? 0 : vendors.length - 1
        : (highlightedIndex + direction + vendors.length) % vendors.length;
      setHighlightedVendorId(vendors[nextIndex].vendorId);
    } else if (event.key === 'Enter' && highlightedIndex >= 0) {
      event.preventDefault();
      selectVendor(vendors[highlightedIndex].vendorId);
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (embedded) return;
    if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
      closePanel(false);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`vendor-selector vendor-selector--${variant}`}
      onBlurCapture={handleBlur}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && panelOpen) {
          event.preventDefault();
          event.stopPropagation();
          if (embedded) onDismiss?.();
          else closePanel(true);
        }
      }}
    >
      {!embedded ? <button
        ref={triggerRef}
        type="button"
        className="vendor-selector__trigger"
        aria-label={`Select vendor: ${selectedName}`}
        aria-haspopup="listbox"
        aria-expanded={panelOpen}
        aria-controls={panelOpen ? listId : undefined}
        disabled={unavailable}
        onClick={() => {
          if (panelOpen) closePanel(false);
          else setOpen(true);
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="vendor-selector__identity">
          <strong title={selectedName}>{selectedName}</strong>
          {selectedVendorId ? <small title={selectedVendorId}>{selectedVendorId}</small> : null}
        </span>
        <span className="vendor-selector__chevron" aria-hidden="true">⌄</span>
      </button> : null}
      {pendingVerification ? <span className="vendor-selector__pending" role="status">Verifying selected Vendor…</span> : null}
      {panelOpen ? (
        <div className={`vendor-selector__panel${embedded ? ' vendor-selector__panel--embedded' : ''}`}>
          <input
            ref={searchRef}
            className="vendor-selector__search"
            role="combobox"
            type="search"
            aria-label="Search vendors"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={highlightedIndex >= 0 ? `${listId}-option-${highlightedIndex}` : undefined}
            placeholder="Search vendor ID or name"
            value={searchValue}
            disabled={unavailable}
            onChange={(event) => {
              setHighlightedVendorId(null);
              onSearchChange(event.target.value);
            }}
            onKeyDown={handleSearchKeyDown}
          />
          {loading ? <span className="vendor-selector__message" role="status">Loading Vendors…</span> : null}
          {error ? (
            <div className="vendor-selector__feedback">
              <span role="alert">{error}</span>
              {onRetry ? <button type="button" onClick={onRetry}>Retry</button> : null}
            </div>
          ) : null}
          <div id={listId} className="vendor-selector__list" role="listbox" aria-label="Vendors">
            {!unavailable && !loading && !error && vendors.map((vendor, index) => (
              <button
                id={`${listId}-option-${index}`}
                key={vendor.vendorId}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={vendor.vendorId === selectedVendorId}
                className="vendor-selector__option"
                data-highlighted={vendor.vendorId === highlightedVendorId || undefined}
                onMouseEnter={() => setHighlightedVendorId(vendor.vendorId)}
                onClick={() => selectVendor(vendor.vendorId)}
              >
                <span className="vendor-selector__option-copy">
                  <strong>{vendor.vendorName}</strong>
                  <small>{vendor.vendorId}</small>
                </span>
                {vendor.vendorId === selectedVendorId ? <span className="vendor-selector__selected">Selected</span> : null}
                {vendor.statusLabel ? <span className="vendor-selector__status">{vendor.statusLabel}</span> : null}
              </button>
            ))}
          </div>
          {!unavailable && !loading && !error && vendors.length === 0 ? (
            <span className="vendor-selector__message" role="status">No Vendors found.</span>
          ) : null}
          {!unavailable && (onPrevious || onNext) ? (
            <div className="vendor-selector__pagination">
              <button type="button" disabled={!onPrevious || !hasPrevious || loading} onClick={onPrevious}>Previous Vendors</button>
              {pageNumber ? <span>Page {pageNumber}</span> : null}
              <button type="button" disabled={!onNext || !hasNext || loading} onClick={onNext}>Next Vendors</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
