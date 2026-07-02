import { redirect } from 'next/navigation';

import DesktopAdminLegacyPage from './page';

jest.mock('next/navigation', () => ({
  redirect: jest.fn(),
}));

describe('DesktopAdminLegacyPage', () => {
  it('redirects the legacy route to /account-sync', () => {
    DesktopAdminLegacyPage();

    expect(redirect).toHaveBeenCalledWith('/account-sync');
  });
});
