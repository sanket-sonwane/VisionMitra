import { StyleSheet, View, TouchableOpacity, Text, TextInput, ScrollView, Alert, Linking } from "react-native";
import { useState, useEffect } from "react";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import axios from "axios";
import { useStore } from "@/store";
import { triggerEmergencyFlow, type EmergencyContact, type SmsMode } from "@/utils/sosService";
import {
  speakLocalizedMessage,
  speakLocalizedText,
  stopLocalizedSpeech,
} from "@/localization/speech";
import {
  callingContactText,
  contactRemovedText,
  sosStatusSummaryText,
} from "@/localization/speechTemplates";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;
const API_TIMEOUT = 10000;

function normalizeBaseUrl(url?: string): string {
  return (url || "").trim().replace(/\/$/, "");
}

function getBackendCandidates(): string[] {
  const configured = normalizeBaseUrl(BACKEND_URL);
  const fallbacks = [
    "http://10.0.2.2:8001",
    "http://127.0.0.1:8001",
    "http://localhost:8001",
  ];

  const candidates = [configured, ...fallbacks].filter(Boolean);
  return Array.from(new Set(candidates));
}

function isNetworkError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return !error.response;
}

async function requestWithFallback<T>(
  executor: (baseUrl: string) => Promise<T>
): Promise<T> {
  const candidates = getBackendCandidates();
  let lastError: unknown;

  for (const baseUrl of candidates) {
    try {
      return await executor(baseUrl);
    } catch (error) {
      lastError = error;
      if (!isNetworkError(error)) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Backend unavailable");
}

export default function Emergency() {
  const router = useRouter();
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newContact, setNewContact] = useState({
    name: "",
    phone: "",
    relationship: "",
  });
  const [sosActive, setSosActive] = useState(false);
  const {
    userId,
    emergencyContacts: storedContacts,
    setEmergencyContacts,
    addEmergencyContact,
    removeEmergencyContact,
  } = useStore();

  useEffect(() => {
    speakLocalizedMessage("EMERGENCY_INTRO");
    loadContacts();
  }, []);

  // Sync local contacts state with store whenever contacts change
  useEffect(() => {
    if (contacts.length > 0) {
      setEmergencyContacts(contacts);
    }
  }, [contacts]);

  const loadContacts = async () => {
    try {
      const response = await requestWithFallback((baseUrl) =>
        axios.get(
          `${baseUrl}/api/emergency-contacts/${userId || "demo_user"}`,
          { timeout: API_TIMEOUT }
        )
      );
      setContacts(response.data);
    } catch (error) {
      console.error("Load contacts error:", error);
      // Fall back to locally stored contacts
      if (storedContacts.length > 0) {
        setContacts(storedContacts);
        console.log("Using locally stored contacts as fallback");
      } else if (isNetworkError(error)) {
        speakLocalizedMessage("BACKEND_UNAVAILABLE_LOCAL_CONTACTS");
      }
    }
  };

  const addContact = async () => {
    if (!newContact.name || !newContact.phone) {
      speakLocalizedMessage("ENTER_NAME_AND_PHONE");
      return;
    }

    const contactData: EmergencyContact = {
      id: `local_${Date.now()}`,
      name: newContact.name,
      phone: newContact.phone,
      relationship: newContact.relationship || "Contact",
      priority: contacts.length + 1,
    };

    // Try backend first
    try {
      const response = await requestWithFallback((baseUrl) =>
        axios.post(
          `${baseUrl}/api/emergency-contacts`,
          {
            user_id: userId || "demo_user",
            name: newContact.name,
            phone: newContact.phone,
            relationship: newContact.relationship || "Contact",
            priority: contacts.length + 1,
          },
          { timeout: API_TIMEOUT }
        )
      );
      // Use backend-returned contact (has server-generated id)
      const serverContact = response.data;
      setContacts((prev) => [...prev, serverContact]);
      addEmergencyContact(serverContact);
    } catch (error) {
      console.warn("Backend add failed, saving locally:", error);
      // Save locally even if backend fails
      setContacts((prev) => [...prev, contactData]);
      addEmergencyContact(contactData);
    }

    speakLocalizedMessage("CONTACT_ADDED_SUCCESS");
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setNewContact({ name: "", phone: "", relationship: "" });
    setShowAddForm(false);
  };

  const deleteContact = async (contactId: string, name: string) => {
    // Always remove locally
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
    removeEmergencyContact(contactId);

    // Try backend (non-fatal)
    try {
      await requestWithFallback((baseUrl) =>
        axios.delete(`${baseUrl}/api/emergency-contacts/${contactId}`, {
          timeout: API_TIMEOUT,
        })
      );
    } catch (error) {
      console.warn("Backend delete failed, removed locally:", error);
    }

    speakLocalizedText(contactRemovedText(name));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const triggerSOS = async () => {
    if (contacts.length === 0) {
      speakLocalizedMessage("ADD_CONTACTS_FIRST");
      Alert.alert(
        "No Contacts",
        "Please add emergency contacts before using SOS.",
        [{ text: "OK" }]
      );
      return;
    }

    try {
      setSosActive(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speakLocalizedMessage("SOS_ACTIVATED");

      const smsMode: SmsMode = process.env.EXPO_PUBLIC_SOS_SMS_MODE === "direct" ? "direct" : "composer";

      const result = await triggerEmergencyFlow({
        contacts,
        userId: userId || "demo_user",
        backendUrl: BACKEND_URL,
        modePreference: smsMode,
      });

      speakLocalizedText(
        sosStatusSummaryText(
          result.location.locationAvailable,
          result.notify.modeUsed,
          result.backendLogged
        )
      );

      if (result.notify.notifyErrors.length > 0) {
        console.warn("SOS notify issues:", result.notify.notifyErrors);
      }

      if (result.topPriorityContact) {
        Alert.alert(
          "SOS Activated",
          `Quick call ${result.topPriorityContact.name}?`,
          [
            { text: "Skip", style: "cancel" },
            {
              text: "Call",
              onPress: () => {
                Linking.openURL(`tel:${result.topPriorityContact?.phone}`);
              },
            },
          ]
        );
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setTimeout(() => setSosActive(false), 3000);
    } catch (error) {
      console.error("SOS error:", error);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      speakLocalizedMessage("SOS_FLOW_FAILED");
      setSosActive(false);
    }
  };

  const callContact = (phone: string, name: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    speakLocalizedText(callingContactText(name));
    Linking.openURL(`tel:${phone}`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            stopLocalizedSpeech();
            router.back();
          }}
        >
          <Ionicons name="arrow-back" size={28} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Emergency</Text>
        <View style={{ width: 44 }} />
      </View>

      <View style={styles.sosContainer}>
        <TouchableOpacity
          style={[styles.sosButton, sosActive && styles.sosButtonActive]}
          onPress={triggerSOS}
          disabled={sosActive}
          onLongPress={() => speakLocalizedMessage("SOS_BUTTON_HINT")}
        >
          <Ionicons name="alert-circle" size={64} color="#fff" />
          <Text style={styles.sosText}>{sosActive ? "SENDING..." : "SOS"}</Text>
        </TouchableOpacity>
        <Text style={styles.sosHint}>Press to alert emergency contacts</Text>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Emergency Contacts</Text>
            <TouchableOpacity
              style={styles.addButton}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowAddForm(!showAddForm);
                speakLocalizedMessage(
                  showAddForm ? "CANCEL_LABEL" : "ADD_NEW_CONTACT_LABEL"
                );
              }}
            >
              <Ionicons name={showAddForm ? "close" : "add"} size={24} color="#2196F3" />
            </TouchableOpacity>
          </View>

          {showAddForm && (
            <View style={styles.addForm}>
              <TextInput
                style={styles.input}
                placeholder="Name"
                placeholderTextColor="#666"
                value={newContact.name}
                onChangeText={(text) => setNewContact({ ...newContact, name: text })}
              />
              <TextInput
                style={styles.input}
                placeholder="Phone Number"
                placeholderTextColor="#666"
                keyboardType="phone-pad"
                value={newContact.phone}
                onChangeText={(text) => setNewContact({ ...newContact, phone: text })}
              />
              <TextInput
                style={styles.input}
                placeholder="Relationship (optional)"
                placeholderTextColor="#666"
                value={newContact.relationship}
                onChangeText={(text) => setNewContact({ ...newContact, relationship: text })}
              />
              <TouchableOpacity style={styles.submitButton} onPress={addContact}>
                <Text style={styles.submitButtonText}>Add Contact</Text>
              </TouchableOpacity>
            </View>
          )}

          {contacts.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={48} color="#666" />
              <Text style={styles.emptyText}>No emergency contacts added</Text>
              <Text style={styles.emptyHint}>Add contacts to use SOS feature</Text>
            </View>
          ) : (
            contacts.map((contact) => (
              <View key={contact.id} style={styles.contactCard}>
                <View style={styles.contactIcon}>
                  <Ionicons name="person" size={24} color="#2196F3" />
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{contact.name}</Text>
                  <Text style={styles.contactPhone}>{contact.phone}</Text>
                  {contact.relationship && (
                    <Text style={styles.contactRelation}>{contact.relationship}</Text>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.callButton}
                  onPress={() => callContact(contact.phone, contact.name)}
                  onLongPress={() => speakLocalizedText(callingContactText(contact.name))}
                >
                  <Ionicons name="call" size={24} color="#4CAF50" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={() => deleteContact(contact.id, contact.name)}
                >
                  <Ionicons name="trash" size={20} color="#F44336" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#121212",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    backgroundColor: "#1a1a1a",
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#fff",
  },
  sosContainer: {
    alignItems: "center",
    paddingVertical: 32,
    backgroundColor: "#1a1a1a",
  },
  sosButton: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "#F44336",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#F44336",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 16,
    elevation: 12,
  },
  sosButtonActive: {
    backgroundColor: "#B71C1C",
    transform: [{ scale: 0.95 }],
  },
  sosText: {
    fontSize: 32,
    fontWeight: "900",
    color: "#fff",
    marginTop: 8,
  },
  sosHint: {
    fontSize: 14,
    color: "#B0B0B0",
    marginTop: 16,
  },
  content: {
    flex: 1,
  },
  section: {
    padding: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#fff",
  },
  addButton: {
    padding: 8,
  },
  addForm: {
    backgroundColor: "#1E1E1E",
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
    gap: 12,
  },
  input: {
    backgroundColor: "#2A2A2A",
    color: "#fff",
    padding: 16,
    borderRadius: 8,
    fontSize: 16,
  },
  submitButton: {
    backgroundColor: "#2196F3",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  contactCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1E1E1E",
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  contactIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#2196F3",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 4,
  },
  contactPhone: {
    fontSize: 14,
    color: "#B0B0B0",
    marginBottom: 2,
  },
  contactRelation: {
    fontSize: 12,
    color: "#808080",
  },
  callButton: {
    padding: 12,
    marginRight: 8,
  },
  deleteButton: {
    padding: 12,
  },
  emptyState: {
    alignItems: "center",
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    marginTop: 16,
  },
  emptyHint: {
    fontSize: 14,
    color: "#555",
    marginTop: 8,
  },
});
