import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { api } from "@/api/client";

export default function Index() {
  const [status, setStatus] = useState("API: checking...");

  useEffect(() => {
    // The first real call through the generated client; `data` is typed from the API's schema.
    api
      .GET("/health")
      .then(({ data }) => setStatus(data ? `API: ${data.status}` : "API: error"))
      .catch(() => setStatus("API: unreachable"));
  }, []);

  return (
    <View style={styles.container}>
      <Text>{status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
