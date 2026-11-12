import { openNotes } from '@features/notes/gate';
import { Button } from '@repo/design-system/ui/button';
import { Screen } from '@repo/design-system/ui/screen';
import { Text } from '@repo/design-system/ui/text';
import { useLoad } from '@repo/sync/ui/sync-provider';
import { useRouter } from 'one';
import { View } from 'react-native';

/** The home screen. Its one action opens the notes through their gate. */
export default function Home() {
  const router = useRouter();
  const load = useLoad();
  return (
    <Screen>
      <View className="items-start gap-4 px-4">
        <View className="gap-2">
          {/* kickoff: the name of the product and what it does. */}
          <Text variant="heading">Clutch</Text>
          <Text tone="muted">
            Notes that work offline. Each change shows at once and reaches your other devices in the
            background.
          </Text>
        </View>
        <Button
          variant="primary"
          onPress={() => openNotes({ navigate: (href) => router.push(href), load })}
        >
          Open notes
        </Button>
      </View>
    </Screen>
  );
}
