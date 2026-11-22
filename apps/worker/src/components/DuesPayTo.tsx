import { StyleSheet, Text, View } from 'react-native';

import { accountName, type MyDues } from '@/features/dues/rules';
import { t } from '@/i18n';
import { colors, fontFamily } from '@/theme';

// Where to pay DHA (migration 0075): one card per account staff entered, with the number large so it is easy to read and copy
// (press and hold; a copy button needs a native module, so it waits for the next phone build). The free text staff may add
// under the accounts is shown as a note. With nothing entered the worker is told to contact support.
export function DuesPayTo({ dues }: { dues: Pick<MyDues, 'payAccounts' | 'payTo'> }) {
  if (dues.payAccounts.length === 0 && dues.payTo === '') return <Text style={styles.note}>{t('dues.payNone')}</Text>;
  return (
    <View style={{ gap: 10 }}>
      {dues.payAccounts.map((a, i) => (
        <View key={`${a.method}-${i}`} style={styles.tile}>
          <Text style={styles.method}>{accountName(a)}</Text>
          <Text style={styles.number} selectable>
            {a.number}
          </Text>
          {a.title !== '' ? <Text style={styles.title}>{t('dues.accountTitle', { title: a.title })}</Text> : null}
        </View>
      ))}
      {dues.payAccounts.length > 0 ? <Text style={styles.hint}>{t('dues.holdToCopy')}</Text> : null}
      {dues.payTo !== '' ? (
        <Text style={styles.note} selectable>
          {dues.payTo}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#DCE8E1', padding: 12, gap: 2 },
  method: { fontFamily: fontFamily.bold, fontSize: 12, letterSpacing: 0.4, color: colors.muted },
  number: { fontFamily: fontFamily.extrabold, fontSize: 20, color: colors.greenDark },
  title: { fontFamily: fontFamily.semibold, fontSize: 13, color: colors.ink },
  hint: { fontFamily: fontFamily.semibold, fontSize: 12, color: colors.muted },
  note: { fontFamily: fontFamily.semibold, fontSize: 13, lineHeight: 19, color: colors.ink },
});
