import { StyleSheet, View, TouchableOpacity, Text, TextInput, ScrollView, Alert, Linking } from "react-native";
import { useState, useEffect, useCallback } from "react";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { useRouter } from "expo-router";
import { useStore } from "@/store";
import { triggerEmergencyFlow, type EmergencyContact, type SmsMode } from "@/utils/sosService";

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
    emergencyContacts,
    addEmergencyContact,
    removeEmergencyContact,
  } = useStore();

  const loadContacts = useCallback(async () => {
    setContacts(emergencyContacts);
  }, [emergencyContacts]);

  useEffect(() => {
    Speech.speak("Emergency contacts. Add contacts for SOS alerts.");
    loadContacts();
  }, [loadContacts]);

  const addContact = async () => {
    if (!newContact.name || !newContact.phone) {
      Speech.speak("Please enter name and phone number.");
      return;
    }

    try {
      const contact: EmergencyContact = {
        id: `local_${Date.now()}`,
        name: newContact.name.trim(),
        phone: newContact.phone.trim(),
        relationship: (newContact.relationship || "Contact").trim(),
        priority: contacts.length + 1,
      };
      addEmergencyContact(contact);

      Speech.speak("Contact added successfully.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setNewContact({ name: "", phone: "", relationship: "" });
      setShowAddForm(false);
      loadContacts();
    } catch (error) {
      console.error("Add contact error:", error);
      Speech.speak("Failed to add contact.");
    }
  };

  const deleteContact = async (contactId: string, name: string) => {
    try {
      removeEmergencyContact(contactId);
      Speech.speak(`${name} removed.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadContacts();
    } catch (error) {
      console.error("Delete contact error:", error);
      Speech.speak("Failed to remove contact.");
    }
  };

  const triggerSOS = async () => {
    if (contacts.length === 0) {
      Speech.speak("Add emergency contacts first.");
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
      Speech.speak("SOS activated. Getting your location and notifying contacts.");

      const smsMode: SmsMode = process.env.EXPO_PUBLIC_SOS_SMS_MODE === "direct" ? "direct" : "composer";

      const result = await triggerEmergencyFlow({
        contacts,
        modePreference: smsMode,
      });

      const locationMessage = result.location.locationAvailable
        ? "Location shared."
        : "Location unavailable, but alert message prepared.";
      const notifyMessage =
        result.notify.modeUsed === "failed"
          ? "Unable to open SMS automatically. Please call manually."
          : result.notify.modeUsed === "direct"
          ? "Direct SMS attempted for emergency contacts."
          : "Opened SMS composer for emergency contacts.";

      Speech.speak(`${locationMessage} ${notifyMessage}`);

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
      Speech.speak("Failed to complete SOS flow. Please call emergency contact manually.");
      setSosActive(false);
    }
  };

  const callContact = (phone: string, name: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Speech.speak(`Calling ${name}`);
    Linking.openURL(`tel:${phone}`);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            Speech.stop();
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
          onLongPress={() =>
            Speech.speak("Emergency SOS button. Press to alert all emergency contacts with your location.")
          }
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
                Speech.speak(showAddForm ? "Cancel" : "Add new contact");
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
                  onLongPress={() => Speech.speak(`Call ${contact.name}`)}
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
