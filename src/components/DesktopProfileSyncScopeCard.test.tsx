import { fireEvent, render, screen } from '@testing-library/react';

import DesktopProfileSyncScopeCard from './DesktopProfileSyncScopeCard';

describe('DesktopProfileSyncScopeCard', () => {
  it('shows adminsettings only for admin roles', () => {
    render(
      <DesktopProfileSyncScopeCard
        selectedDomains={['playrecords']}
        isAdminRole
        onChange={jest.fn()}
      />
    );

    expect(screen.getByLabelText('管理员设置')).toBeInTheDocument();
  });

  it('hides adminsettings for non-admin roles', () => {
    render(
      <DesktopProfileSyncScopeCard
        selectedDomains={['playrecords']}
        isAdminRole={false}
        onChange={jest.fn()}
      />
    );

    expect(screen.queryByLabelText('管理员设置')).not.toBeInTheDocument();
  });

  it('emits the next selected domains when a checkbox is toggled', () => {
    const onChange = jest.fn();

    render(
      <DesktopProfileSyncScopeCard
        selectedDomains={['playrecords']}
        isAdminRole={false}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByLabelText('收藏'));

    expect(onChange).toHaveBeenCalledWith(['playrecords', 'favorites']);
  });
});
