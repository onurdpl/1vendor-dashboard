import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { VendorSelector, type VendorSelectorProps } from './VendorSelector';

const vendors = [
  { vendorId: 'vendor-a', vendorName: 'Shared Name', statusLabel: 'Active' as const },
  { vendorId: 'vendor-b', vendorName: 'Shared Name', statusLabel: 'Restricted' as const },
  { vendorId: 'vendor-c', vendorName: 'Sporjinal', statusLabel: 'Active' as const },
];

function props(overrides: Partial<VendorSelectorProps> = {}): VendorSelectorProps {
  return {
    variant: 'light',
    selectedVendorId: 'vendor-a',
    selectedVendor: vendors[0],
    vendors,
    searchValue: '',
    onSearchChange: vi.fn(),
    onSelectVendor: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('VendorSelector presentation', () => {
  it('starts closed and shows the selected name and exact ID in both visual variants', async () => {
    const actor = userEvent.setup();
    const view = render(<VendorSelector {...props()} />);
    const trigger = screen.getByRole('button', { name: 'Select vendor: Shared Name' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('vendor-a')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(view.container.querySelector('.vendor-selector--light')).toBeTruthy();

    view.rerender(<VendorSelector {...props({ variant: 'dark' })} />);
    expect(view.container.querySelector('.vendor-selector--dark')).toBeTruthy();
    await actor.click(trigger);
    expect(screen.getByRole('listbox', { name: 'Vendors' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Search vendors' })).toHaveProperty('value', '');
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Search vendors' }));
    await actor.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('accepts server-driven search without filtering the supplied result page locally', async () => {
    const actor = userEvent.setup();
    const onSearchChange = vi.fn();
    function ControlledSearch() {
      const [value, setValue] = useState('');
      return <VendorSelector {...props({ searchValue: value, onSearchChange: (next) => {
        onSearchChange(next);
        setValue(next);
      } })} />;
    }
    render(<ControlledSearch />);
    await actor.click(screen.getByRole('button', { name: /Select vendor:/ }));
    await actor.type(screen.getByRole('combobox', { name: 'Search vendors' }), 'other');
    expect(onSearchChange).toHaveBeenLastCalledWith('other');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('uses exact Vendor IDs for duplicate names and keeps Restricted Vendors selectable', async () => {
    const actor = userEvent.setup();
    const onSelectVendor = vi.fn();
    render(<VendorSelector {...props({ onSelectVendor })} />);
    await actor.click(screen.getByRole('button', { name: /Select vendor:/ }));
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-selected')).toBe('false');
    expect(within(options[1]).getByText('Restricted')).toBeTruthy();
    await actor.click(options[1]);
    expect(onSelectVendor).toHaveBeenCalledExactlyOnceWith('vendor-b');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Select vendor:/ }));
  });

  it('opens with keyboard, navigates results and selects only on Enter', async () => {
    const actor = userEvent.setup();
    const onSelectVendor = vi.fn();
    render(<VendorSelector {...props({ onSelectVendor })} />);
    const trigger = screen.getByRole('button', { name: /Select vendor:/ });
    trigger.focus();
    await actor.keyboard('{Enter}');
    const search = screen.getByRole('combobox', { name: 'Search vendors' });
    expect(document.activeElement).toBe(search);
    await actor.keyboard('{ArrowDown}{ArrowDown}');
    expect(onSelectVendor).not.toHaveBeenCalled();
    expect(search.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id);
    await actor.keyboard('{Enter}');
    expect(onSelectVendor).toHaveBeenCalledExactlyOnceWith('vendor-b');
    expect(document.activeElement).toBe(trigger);
  });

  it('supports Space, ArrowUp, Escape and focus restoration without committing a highlight', async () => {
    const actor = userEvent.setup();
    const onSelectVendor = vi.fn();
    render(<VendorSelector {...props({ onSelectVendor })} />);
    const trigger = screen.getByRole('button', { name: /Select vendor:/ });
    trigger.focus();
    await actor.keyboard(' ');
    const search = screen.getByRole('combobox', { name: 'Search vendors' });
    await actor.keyboard('{ArrowUp}');
    expect(search.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[2].id);
    expect(onSelectVendor).not.toHaveBeenCalled();
    await actor.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(onSelectVendor).not.toHaveBeenCalled();
  });

  it('keeps long names and IDs available to assistive technology in a narrow variant', async () => {
    const actor = userEvent.setup();
    const longName = `Vendor ${'Very Long Name '.repeat(12)}`;
    const longId = `vendor-${'long-'.repeat(15)}b`;
    render(<VendorSelector {...props({
      variant: 'dark', selectedVendorId: longId,
      selectedVendor: { vendorId: longId, vendorName: longName },
      vendors: [{ vendorId: longId, vendorName: longName }],
    })} />);
    const trigger = screen.getByRole('button', { name: /Select vendor: Vendor Very Long Name/ });
    expect(trigger.getAttribute('aria-label')).toBe(`Select vendor: ${longName}`);
    expect(within(trigger).getByText(longId)).toBeTruthy();
    await actor.click(trigger);
    expect(screen.getByRole('option').textContent).toContain(longName);
    expect(screen.getByRole('option').textContent).toContain(longId);
  });

  it('announces loading, empty and error states and provides a retry action', async () => {
    const actor = userEvent.setup();
    const onRetry = vi.fn();
    const view = render(<VendorSelector {...props({ vendors: [], loading: true })} />);
    await actor.click(screen.getByRole('button', { name: /Select vendor:/ }));
    expect(screen.getByRole('status', { name: '' }).textContent).toContain('Loading Vendors');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    view.rerender(<VendorSelector {...props({ vendors: [] })} />);
    expect(screen.getByText('No Vendors found.')).toBeTruthy();
    view.rerender(<VendorSelector {...props({ vendors: [], error: 'Vendor directory failed.', onRetry })} />);
    expect(screen.getByRole('alert').textContent).toContain('Vendor directory failed.');
    expect(screen.queryByText('No Vendors found.')).toBeNull();
    await actor.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('uses supplied pagination callbacks and supports Tab navigation', async () => {
    const actor = userEvent.setup();
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    render(<VendorSelector {...props({ pageNumber: 2, hasPrevious: true, hasNext: true, onPrevious, onNext })} />);
    await actor.click(screen.getByRole('button', { name: /Select vendor:/ }));
    expect(screen.getByText('Page 2')).toBeTruthy();
    await actor.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Previous Vendors' }));
    await actor.click(screen.getByRole('button', { name: 'Previous Vendors' }));
    await actor.click(screen.getByRole('button', { name: 'Next Vendors' }));
    expect(onPrevious).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('disables unavailable pagination and selection during pending verification', async () => {
    const actor = userEvent.setup();
    const onSelectVendor = vi.fn();
    const view = render(<VendorSelector {...props({
      onSelectVendor, pageNumber: 1, hasPrevious: false, hasNext: true,
      onPrevious: vi.fn(), onNext: vi.fn(),
    })} />);
    await actor.click(screen.getByRole('button', { name: /Select vendor:/ }));
    expect((screen.getByRole('button', { name: 'Previous Vendors' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<VendorSelector {...props({ onSelectVendor, pendingVerification: true })} />);
    expect(screen.getByRole('status').textContent).toContain('Verifying selected Vendor');
    expect((screen.getByRole('button', { name: /Select vendor:/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSelectVendor).not.toHaveBeenCalled();
    view.rerender(<VendorSelector {...props({ onSelectVendor, disabled: true })} />);
    expect((screen.getByRole('button', { name: /Select vendor:/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('falls back to the exact selected ID instead of showing another Vendor name', () => {
    render(<VendorSelector {...props({ selectedVendorId: 'vendor-unknown', selectedVendor: vendors[0], vendors: [] })} />);
    expect(screen.getByRole('button', { name: 'Select vendor: vendor-unknown' })).toBeTruthy();
    expect(screen.queryByText('Shared Name')).toBeNull();
  });
});
