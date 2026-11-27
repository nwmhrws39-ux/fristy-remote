import { Component, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

/** Keeps one broken section from blanking the whole screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ backgroundColor: '#ff4d6a22', borderRadius: 14, padding: 16, marginBottom: 12 }}>
        <Text style={{ color: '#ff4d6a', fontWeight: '800' }}>משהו השתבש כאן · Something went wrong here.</Text>
        <Text style={{ color: '#aaa', fontSize: 11, marginTop: 4 }}>{this.state.error.message}</Text>
        <Pressable onPress={() => this.setState({ error: null })} style={{ marginTop: 10 }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>↻ נסה שוב</Text>
        </Pressable>
      </View>
    );
  }
}
