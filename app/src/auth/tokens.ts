import * as SecureStore from "expo-secure-store";

// SecureStore keeps these in the iPhone Keychain / Android Keystore: encrypted and private to
// the app, unlike plain storage. Keys may only contain letters, digits, ".", "-" and "_".
const ACCESS = "studio.accessToken";
const REFRESH = "studio.refreshToken";

export type Tokens = { access: string; refresh: string };

export async function saveTokens(tokens: Tokens): Promise<void> {
  await SecureStore.setItemAsync(ACCESS, tokens.access);
  await SecureStore.setItemAsync(REFRESH, tokens.refresh);
}

export async function loadTokens(): Promise<Tokens | null> {
  const [access, refresh] = await Promise.all([
    SecureStore.getItemAsync(ACCESS),
    SecureStore.getItemAsync(REFRESH),
  ]);
  return access && refresh ? { access, refresh } : null;
}

export async function clearTokens(): Promise<void> {
  await Promise.all([SecureStore.deleteItemAsync(ACCESS), SecureStore.deleteItemAsync(REFRESH)]);
}
