import { h, replace } from '../../lib/dom.js';
import { openSharedById } from '../../services/sharing.js';
import { KIND } from '../../services/client.js';
import { loading, emptyState } from '../components.js';

/** #/open/:fileId — deep link used when someone shares a workbook via the app. */
export async function render(root, { params, setTitle, navigate }) {
  setTitle('Opening shared file…');
  replace(root, loading('Connecting to the shared file…'));
  try {
    const { file, kind } = await openSharedById(params.fileId);
    if (kind === KIND.plans) navigate(`/plans/${file.id}`, { replace: true });
    else if (kind === KIND.expenses) navigate('/expenses', { replace: true });
    else navigate('/todos', { replace: true });
  } catch (e) {
    replace(root, emptyState({ emoji: '🔒', title: 'Could not open that file', text: `${e.message} Ask the owner to share it with the Google account you signed in with, then try again or use “Shared with me”.`, action: h('a', { class: 'btn', href: '#/shared' }, 'Go to Shared with me') }));
  }
}
