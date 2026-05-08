export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      bot_messages: {
        Row: {
          created_at: string
          description: string
          id: string
          message_key: string
          message_text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          message_key: string
          message_text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          message_key?: string
          message_text?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversation_audit_logs: {
        Row: {
          action: string
          conversation_id: string
          conversation_source: string
          created_at: string
          id: string
          new_value: string | null
          old_value: string | null
          performed_by: string
        }
        Insert: {
          action: string
          conversation_id: string
          conversation_source: string
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          performed_by?: string
        }
        Update: {
          action?: string
          conversation_id?: string
          conversation_source?: string
          created_at?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          performed_by?: string
        }
        Relationships: []
      }
      conversation_mappings: {
        Row: {
          classification: string | null
          created_at: string
          csat_prompt_ts: string | null
          csat_rated_at: string | null
          csat_rating: number | null
          csat_remark: string | null
          id: string
          intercom_contact_id: string
          intercom_conversation_id: string | null
          intercom_ticket_id: string | null
          is_bug: boolean
          is_feature_request: boolean
          is_test: boolean
          last_intercom_part_id: string | null
          last_processed_event_ts: string | null
          original_message_text: string
          owner: string | null
          product_area: string | null
          prompt_message_ts: string | null
          reminder_sent_at: string | null
          resolved_at: string | null
          slack_channel_id: string
          slack_thread_ts: string
          slack_user_id: string
          slack_user_name: string | null
          status: string
          updated_at: string
        }
        Insert: {
          classification?: string | null
          created_at?: string
          csat_prompt_ts?: string | null
          csat_rated_at?: string | null
          csat_rating?: number | null
          csat_remark?: string | null
          id?: string
          intercom_contact_id?: string
          intercom_conversation_id?: string | null
          intercom_ticket_id?: string | null
          is_bug?: boolean
          is_feature_request?: boolean
          is_test?: boolean
          last_intercom_part_id?: string | null
          last_processed_event_ts?: string | null
          original_message_text?: string
          owner?: string | null
          product_area?: string | null
          prompt_message_ts?: string | null
          reminder_sent_at?: string | null
          resolved_at?: string | null
          slack_channel_id: string
          slack_thread_ts: string
          slack_user_id?: string
          slack_user_name?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          classification?: string | null
          created_at?: string
          csat_prompt_ts?: string | null
          csat_rated_at?: string | null
          csat_rating?: number | null
          csat_remark?: string | null
          id?: string
          intercom_contact_id?: string
          intercom_conversation_id?: string | null
          intercom_ticket_id?: string | null
          is_bug?: boolean
          is_feature_request?: boolean
          is_test?: boolean
          last_intercom_part_id?: string | null
          last_processed_event_ts?: string | null
          original_message_text?: string
          owner?: string | null
          product_area?: string | null
          prompt_message_ts?: string | null
          reminder_sent_at?: string | null
          resolved_at?: string | null
          slack_channel_id?: string
          slack_thread_ts?: string
          slack_user_id?: string
          slack_user_name?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      conversation_notes: {
        Row: {
          author: string
          conversation_id: string
          conversation_source: string
          created_at: string
          id: string
          note_text: string
        }
        Insert: {
          author?: string
          conversation_id: string
          conversation_source?: string
          created_at?: string
          id?: string
          note_text?: string
        }
        Update: {
          author?: string
          conversation_id?: string
          conversation_source?: string
          created_at?: string
          id?: string
          note_text?: string
        }
        Relationships: []
      }
      flow_node_positions: {
        Row: {
          id: string
          updated_at: string
          x: number
          y: number
        }
        Insert: {
          id: string
          updated_at?: string
          x: number
          y: number
        }
        Update: {
          id?: string
          updated_at?: string
          x?: number
          y?: number
        }
        Relationships: []
      }
      gmail_conversations: {
        Row: {
          cc_emails: string | null
          classification: string | null
          created_at: string
          csat_rated_at: string | null
          csat_rating: number | null
          csat_remark: string | null
          from_email: string | null
          from_name: string | null
          gmail_message_id: string
          gmail_thread_id: string | null
          id: string
          intercom_conversation_id: string | null
          is_bug: boolean
          is_feature_request: boolean
          is_test: boolean
          owner: string | null
          product_area: string | null
          received_at: string | null
          resolved_at: string | null
          snippet: string | null
          status: string
          subject: string | null
          to_emails: string | null
        }
        Insert: {
          cc_emails?: string | null
          classification?: string | null
          created_at?: string
          csat_rated_at?: string | null
          csat_rating?: number | null
          csat_remark?: string | null
          from_email?: string | null
          from_name?: string | null
          gmail_message_id: string
          gmail_thread_id?: string | null
          id?: string
          intercom_conversation_id?: string | null
          is_bug?: boolean
          is_feature_request?: boolean
          is_test?: boolean
          owner?: string | null
          product_area?: string | null
          received_at?: string | null
          resolved_at?: string | null
          snippet?: string | null
          status?: string
          subject?: string | null
          to_emails?: string | null
        }
        Update: {
          cc_emails?: string | null
          classification?: string | null
          created_at?: string
          csat_rated_at?: string | null
          csat_rating?: number | null
          csat_remark?: string | null
          from_email?: string | null
          from_name?: string | null
          gmail_message_id?: string
          gmail_thread_id?: string | null
          id?: string
          intercom_conversation_id?: string | null
          is_bug?: boolean
          is_feature_request?: boolean
          is_test?: boolean
          owner?: string | null
          product_area?: string | null
          received_at?: string | null
          resolved_at?: string | null
          snippet?: string | null
          status?: string
          subject?: string | null
          to_emails?: string | null
        }
        Relationships: []
      }
      gmail_oauth_tokens: {
        Row: {
          access_token: string
          created_at: string
          email_address: string | null
          id: string
          refresh_token: string
          token_expires_at: string
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          email_address?: string | null
          id?: string
          refresh_token: string
          token_expires_at: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          email_address?: string | null
          id?: string
          refresh_token?: string
          token_expires_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      knowledge_documents: {
        Row: {
          content: string
          id: string
          pending_at: string | null
          pending_content: string | null
          pending_summary: string | null
          updated_at: string
        }
        Insert: {
          content?: string
          id?: string
          pending_at?: string | null
          pending_content?: string | null
          pending_summary?: string | null
          updated_at?: string
        }
        Update: {
          content?: string
          id?: string
          pending_at?: string | null
          pending_content?: string | null
          pending_summary?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      manual_conversations: {
        Row: {
          classification: string | null
          contact_name: string
          created_at: string
          csat_rated_at: string | null
          csat_rating: number | null
          csat_remark: string | null
          id: string
          intercom_conversation_id: string | null
          is_bug: boolean
          is_feature_request: boolean
          is_test: boolean
          link: string | null
          owner: string | null
          product_area: string | null
          resolved_at: string | null
          source: string
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          classification?: string | null
          contact_name?: string
          created_at?: string
          csat_rated_at?: string | null
          csat_rating?: number | null
          csat_remark?: string | null
          id?: string
          intercom_conversation_id?: string | null
          is_bug?: boolean
          is_feature_request?: boolean
          is_test?: boolean
          link?: string | null
          owner?: string | null
          product_area?: string | null
          resolved_at?: string | null
          source?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Update: {
          classification?: string | null
          contact_name?: string
          created_at?: string
          csat_rated_at?: string | null
          csat_rating?: number | null
          csat_remark?: string | null
          id?: string
          intercom_conversation_id?: string | null
          is_bug?: boolean
          is_feature_request?: boolean
          is_test?: boolean
          link?: string | null
          owner?: string | null
          product_area?: string | null
          resolved_at?: string | null
          source?: string
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      manual_messages: {
        Row: {
          conversation_id: string
          created_at: string
          id: string
          is_internal_note: boolean
          message_text: string
          role: string
          sender_name: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          message_text?: string
          role?: string
          sender_name?: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          id?: string
          is_internal_note?: boolean
          message_text?: string
          role?: string
          sender_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "manual_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_intercom_links: {
        Row: {
          attempts: number
          contact_email: string | null
          contact_name: string | null
          created_at: string
          id: string
          intercom_conversation_id: string
          intercom_created_at: string
          last_attempt_at: string | null
          normalized_subject: string
          pre_messages: Json
          resolved_owner: string | null
          source_payload: Json
        }
        Insert: {
          attempts?: number
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          intercom_conversation_id: string
          intercom_created_at: string
          last_attempt_at?: string | null
          normalized_subject: string
          pre_messages: Json
          resolved_owner?: string | null
          source_payload: Json
        }
        Update: {
          attempts?: number
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          intercom_conversation_id?: string
          intercom_created_at?: string
          last_attempt_at?: string | null
          normalized_subject?: string
          pre_messages?: Json
          resolved_owner?: string | null
          source_payload?: Json
        }
        Relationships: []
      }
      settings: {
        Row: {
          admin_owner_map: string
          auto_mark_employee_test: boolean
          created_at: string
          gmail_last_polled_at: string | null
          id: string
          intercom_assignee_id: string
          intercom_inbox_id: string
          last_polled_intercom_at: string | null
          last_polled_ts: string
          monitored_channels: string
          product_areas: string
          slack_bot_user_id: string
          test_intercom_inbox_id: string
          testing_mode: boolean
          updated_at: string
        }
        Insert: {
          admin_owner_map?: string
          auto_mark_employee_test?: boolean
          created_at?: string
          gmail_last_polled_at?: string | null
          id?: string
          intercom_assignee_id?: string
          intercom_inbox_id?: string
          last_polled_intercom_at?: string | null
          last_polled_ts?: string
          monitored_channels?: string
          product_areas?: string
          slack_bot_user_id?: string
          test_intercom_inbox_id?: string
          testing_mode?: boolean
          updated_at?: string
        }
        Update: {
          admin_owner_map?: string
          auto_mark_employee_test?: boolean
          created_at?: string
          gmail_last_polled_at?: string | null
          id?: string
          intercom_assignee_id?: string
          intercom_inbox_id?: string
          last_polled_intercom_at?: string | null
          last_polled_ts?: string
          monitored_channels?: string
          product_areas?: string
          slack_bot_user_id?: string
          test_intercom_inbox_id?: string
          testing_mode?: boolean
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      auto_close_gmail_threads: { Args: never; Returns: undefined }
      claim_intercom_part: {
        Args: { p_mapping_id: string; p_part_id: string }
        Returns: boolean
      }
      claim_slack_event: {
        Args: { p_event_ts: string; p_mapping_id: string }
        Returns: boolean
      }
      search_conversations: {
        Args: { search_term: string }
        Returns: {
          result_id: string
          result_source: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
