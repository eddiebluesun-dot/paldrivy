import { Platform, ScrollView, Text } from 'react-native';

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface HtmlViewProps {
  html: string;
  maxHeight?: number;
  style?: object;
}

export function HtmlView({ html, maxHeight = 320, style }: HtmlViewProps) {
  if (Platform.OS === 'web') {
    return (
      <div
        style={{
          maxHeight,
          overflowY: 'auto',
          fontSize: 13,
          color: '#374151',
          lineHeight: 1.6,
          ...(style as object ?? {}),
        }}
        // Content comes from our own database, not user input
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <ScrollView style={{ maxHeight, ...(style ?? {}) }} nestedScrollEnabled>
      <Text style={{ fontSize: 13, color: '#374151', lineHeight: 20 }}>
        {stripHtml(html)}
      </Text>
    </ScrollView>
  );
}
