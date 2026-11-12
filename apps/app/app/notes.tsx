import { openNotes } from '@features/notes/gate';
import { NotesScreen } from '@features/notes/screens/notes-screen';
import { generalSpaceId } from '@repo/access/contract/access';
import { useLoad } from '@repo/sync/ui/sync-provider';
import { useParams, useRouter } from 'one';

/** The notes of one space. Only its gate, `openNotes`, navigates here. */
export default function Notes() {
  const { space } = useParams<{ space?: string }>();
  const router = useRouter();
  const load = useLoad();
  return (
    <NotesScreen
      spaceId={typeof space === 'string' && space ? space : generalSpaceId}
      onOpen={(spaceId) => openNotes({ navigate: (href) => router.push(href), load }, spaceId)}
    />
  );
}
