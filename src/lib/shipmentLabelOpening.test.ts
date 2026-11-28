import { afterEach, describe, expect, it, vi } from 'vitest';
import { openShipmentLabel } from './shipmentLabelOpening';

describe('I02 shipment label opening outcomes', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it.each(['https://labels.example/stored.pdf', 'blob:stored-label', '/stored-label.pdf'])(
    'returns the existing URL outcome for %s without claiming popup visibility', (url) => {
      const open = vi.fn(() => null);
      vi.stubGlobal('open', open);
      expect(openShipmentLabel(url)).toEqual({ opened: true, source: 'url' });
      expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
    });

  it('returns a typed failure when a direct browser open throws', () => {
    vi.stubGlobal('open', vi.fn(() => { throw new Error('Browser denied open'); }));
    expect(openShipmentLabel('https://labels.example/stored.pdf')).toEqual({
      opened: false, error: 'Shipment label could not be opened.',
    });
  });

  it.each(['', '   ', 'javascript:alert(1)', 'data:text/html;base64,PGgxPm5vPC9oMT4='])('keeps validation for %j', (value) => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    expect(openShipmentLabel(value).opened).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it('preserves raw base64 PDF opening', () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, {
      createObjectURL: vi.fn(() => 'blob:i02-raw'), revokeObjectURL,
    }));
    const open = vi.fn(() => null);
    vi.stubGlobal('open', open);
    expect(openShipmentLabel(btoa('%PDF-1.4 raw'))).toEqual({ opened: true, source: 'object_url' });
    expect(open).toHaveBeenCalledWith('blob:i02-raw', '_blank', 'noopener,noreferrer');
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:i02-raw');
  });

  it.each([false, true])('revokes a PDF object URL after the existing delay (opening throws: %s)', (throws) => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => 'blob:i02-pdf');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    vi.stubGlobal('open', vi.fn(() => { if (throws) throw new Error('Browser denied PDF'); return null; }));
    expect(openShipmentLabel(`data:application/pdf;base64,${btoa('%PDF-1.4 test')}`)).toEqual(throws
      ? { opened: false, error: 'Shipment label PDF could not be opened.' }
      : { opened: true, source: 'object_url' });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59_999);
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:i02-pdf');
  });
});
