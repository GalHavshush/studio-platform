import * as SecureStore from "expo-secure-store";

// The studio chosen last time, so a restart does not ask again. Not a secret, but secure storage
// is already here, and it is cleared with the tokens at sign-out.
const KEY = "studio.tenantId";

export const saveTenantId = (id: string): Promise<void> => SecureStore.setItemAsync(KEY, id);
export const loadTenantId = (): Promise<string | null> => SecureStore.getItemAsync(KEY);
export const clearTenantId = (): Promise<void> => SecureStore.deleteItemAsync(KEY);
