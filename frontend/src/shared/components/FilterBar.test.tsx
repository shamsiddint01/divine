import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/uz';
import { FilterBar } from './FilterBar';

const phone = (matches: boolean) => {
  const real = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    ...real(query),
    matches: matches && query.includes('639.98px'),
  }));
};

const renderBar = (active: boolean) =>
  render(
    <FilterBar search={<input aria-label="qidiruv" />} active={active}>
      <select aria-label="guruh" />
    </FilterBar>,
  );

afterEach(() => vi.restoreAllMocks());

describe('FilterBar', () => {
  it('kompyuterda qidiruv va filtrlar bir qatorda, alohida tugma yo‘q', () => {
    phone(false);
    renderBar(false);
    expect(screen.getByLabelText('qidiruv')).toBeInTheDocument();
    expect(screen.getByLabelText('guruh')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.common.filters })).toBeNull();
  });

  it('telefonda filtrlar oynada; faol filtr tugmada belgilanadi', async () => {
    phone(true);
    renderBar(true);
    expect(screen.getByLabelText('qidiruv')).toBeInTheDocument();
    expect(screen.queryByLabelText('guruh')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: t.common.filtersActive }));
    const sheet = await screen.findByRole('dialog', { name: t.common.filters });
    expect(within(sheet).getByLabelText('guruh')).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole('button', { name: t.common.showResults }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
