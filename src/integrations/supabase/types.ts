export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      call_sessions: {
        Row: {
          answered_at: string | null;
          conversation_id: string;
          created_at: string;
          ended_at: string | null;
          id: string;
          initiator_id: string;
          kind: string;
          room_name: string;
          status: string;
        };
        Insert: {
          answered_at?: string | null;
          conversation_id: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          initiator_id: string;
          kind: string;
          room_name: string;
          status?: string;
        };
        Update: {
          answered_at?: string | null;
          conversation_id?: string;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          initiator_id?: string;
          kind?: string;
          room_name?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "call_sessions_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          joined_at: string;
          last_read_at: string;
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          joined_at?: string;
          last_read_at?: string;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          joined_at?: string;
          last_read_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          is_group: boolean;
          last_message_at: string;
          name: string | null;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id?: string;
          is_group?: boolean;
          last_message_at?: string;
          name?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          is_group?: boolean;
          last_message_at?: string;
          name?: string | null;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          attachment_name: string | null;
          attachment_size: number | null;
          attachment_type: string | null;
          attachment_url: string | null;
          body: string | null;
          conversation_id: string;
          created_at: string;
          deleted_at: string | null;
          edited_at: string | null;
          effect: string | null;
          id: string;
          media_duration: number | null;
          media_kind: string | null;
          reply_to: string | null;
          sender_id: string;
        };
        Insert: {
          attachment_name?: string | null;
          attachment_size?: number | null;
          attachment_type?: string | null;
          attachment_url?: string | null;
          body?: string | null;
          conversation_id: string;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          effect?: string | null;
          id?: string;
          media_duration?: number | null;
          media_kind?: string | null;
          reply_to?: string | null;
          sender_id: string;
        };
        Update: {
          attachment_name?: string | null;
          attachment_size?: number | null;
          attachment_type?: string | null;
          attachment_url?: string | null;
          body?: string | null;
          conversation_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          edited_at?: string | null;
          effect?: string | null;
          id?: string;
          media_duration?: number | null;
          media_kind?: string | null;
          reply_to?: string | null;
          sender_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_reply_to_fkey";
            columns: ["reply_to"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          id: string;
          last_seen: string;
          last_seen_visible: boolean;
          photo_visible: boolean;
          read_receipts: boolean;
          status_text: string | null;
          status_visible: boolean;
          username: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name: string;
          id: string;
          last_seen?: string;
          last_seen_visible?: boolean;
          photo_visible?: boolean;
          read_receipts?: boolean;
          status_text?: string | null;
          status_visible?: boolean;
          username: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          last_seen?: string;
          last_seen_visible?: boolean;
          photo_visible?: boolean;
          read_receipts?: boolean;
          status_text?: string | null;
          status_visible?: boolean;
          username?: string;
        };
        Relationships: [];
      };
      reactions: {
        Row: {
          created_at: string;
          emoji: string;
          message_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          emoji: string;
          message_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          emoji?: string;
          message_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reactions_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      status_posts: {
        Row: {
          audience_ids: string[];
          audience_mode: string;
          author_id: string;
          background: string | null;
          body: string | null;
          created_at: string;
          expires_at: string;
          id: string;
          is_highlighted: boolean;
          kind: string;
          media_type: string | null;
          media_url: string | null;
        };
        Insert: {
          audience_ids?: string[];
          audience_mode?: string;
          author_id: string;
          background?: string | null;
          body?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          is_highlighted?: boolean;
          kind: string;
          media_type?: string | null;
          media_url?: string | null;
        };
        Update: {
          audience_ids?: string[];
          audience_mode?: string;
          author_id?: string;
          background?: string | null;
          body?: string | null;
          created_at?: string;
          expires_at?: string;
          id?: string;
          is_highlighted?: boolean;
          kind?: string;
          media_type?: string | null;
          media_url?: string | null;
        };
        Relationships: [];
      };
      status_highlights: {
        Row: { saved_at: string; status_id: string; user_id: string };
        Insert: { saved_at?: string; status_id: string; user_id: string };
        Update: { saved_at?: string; status_id?: string; user_id?: string };
        Relationships: [];
      };
      status_mutes: {
        Row: { created_at: string; muted_user_id: string; user_id: string };
        Insert: { created_at?: string; muted_user_id: string; user_id: string };
        Update: { created_at?: string; muted_user_id?: string; user_id?: string };
        Relationships: [];
      };
      status_reactions: {
        Row: { created_at: string; emoji: string; status_id: string; user_id: string };
        Insert: { created_at?: string; emoji: string; status_id: string; user_id: string };
        Update: { created_at?: string; emoji?: string; status_id?: string; user_id?: string };
        Relationships: [];
      };
      status_replies: {
        Row: { body: string; created_at: string; id: string; sender_id: string; status_id: string };
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          sender_id: string;
          status_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          sender_id?: string;
          status_id?: string;
        };
        Relationships: [];
      };
      status_views: {
        Row: {
          status_id: string;
          viewed_at: string;
          viewer_id: string;
        };
        Insert: {
          status_id: string;
          viewed_at?: string;
          viewer_id: string;
        };
        Update: {
          status_id?: string;
          viewed_at?: string;
          viewer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "status_views_status_id_fkey";
            columns: ["status_id"];
            isOneToOne: false;
            referencedRelation: "status_posts";
            referencedColumns: ["id"];
          },
        ];
      };
      typing_status: {
        Row: {
          conversation_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          conversation_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "typing_status_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      create_chat: {
        Args: { _is_group: boolean; _name: string; _other_ids: string[] };
        Returns: string;
      };
      is_member: {
        Args: { _conversation_id: string; _user_id: string };
        Returns: boolean;
      };
      show_limit: { Args: never; Returns: number };
      show_trgm: { Args: { "": string }; Returns: string[] };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
