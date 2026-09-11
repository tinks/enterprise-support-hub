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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_user_connections: {
        Row: {
          connected_email: string | null
          connection_key_ciphertext: string
          connector_id: string
          created_at: string
          id: string
          slack_team_id: string | null
          slack_user_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          connected_email?: string | null
          connection_key_ciphertext: string
          connector_id: string
          created_at?: string
          id?: string
          slack_team_id?: string | null
          slack_user_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          connected_email?: string | null
          connection_key_ciphertext?: string
          connector_id?: string
          created_at?: string
          id?: string
          slack_team_id?: string | null
          slack_user_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
      changelog_entries: {
        Row: {
          area: string | null
          author_user_id: string | null
          body: string | null
          created_at: string
          entry_date: string
          id: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          author_user_id?: string | null
          body?: string | null
          created_at?: string
          entry_date?: string
          id?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          author_user_id?: string | null
          body?: string | null
          created_at?: string
          entry_date?: string
          id?: string
          tags?: string[]
          title?: string
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
      cron_auth: {
        Row: {
          created_at: string
          id: boolean
          rotated_at: string
          secret: string
        }
        Insert: {
          created_at?: string
          id?: boolean
          rotated_at?: string
          secret?: string
        }
        Update: {
          created_at?: string
          id?: boolean
          rotated_at?: string
          secret?: string
        }
        Relationships: []
      }
      csat_overrides: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          created_by_email: string | null
          id: string
          intercom_conversation_id: string | null
          original_rating: number | null
          reason: string
          ticket_id: string
          updated_at: string
        }
        Insert: {
          action?: string
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          intercom_conversation_id?: string | null
          original_rating?: number | null
          reason: string
          ticket_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          created_by_email?: string | null
          id?: string
          intercom_conversation_id?: string | null
          original_rating?: number | null
          reason?: string
          ticket_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "csat_overrides_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: true
            referencedRelation: "intercom_tickets_v3"
            referencedColumns: ["id"]
          },
        ]
      }
      dev_escalation_links: {
        Row: {
          created_at: string
          id: string
          intercom_conversation_id: string
          linear_assignee: string | null
          linear_canceled_at: string | null
          linear_completed_at: string | null
          linear_created_at: string | null
          linear_key: string
          linear_started_at: string | null
          linear_state: string | null
          linear_state_type: string | null
          linear_synced_at: string | null
          linear_title: string | null
          linear_url: string | null
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          intercom_conversation_id: string
          linear_assignee?: string | null
          linear_canceled_at?: string | null
          linear_completed_at?: string | null
          linear_created_at?: string | null
          linear_key: string
          linear_started_at?: string | null
          linear_state?: string | null
          linear_state_type?: string | null
          linear_synced_at?: string | null
          linear_title?: string | null
          linear_url?: string | null
          source?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          intercom_conversation_id?: string
          linear_assignee?: string | null
          linear_canceled_at?: string | null
          linear_completed_at?: string | null
          linear_created_at?: string | null
          linear_key?: string
          linear_started_at?: string | null
          linear_state?: string | null
          linear_state_type?: string | null
          linear_synced_at?: string | null
          linear_title?: string | null
          linear_url?: string | null
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      dev_escalations: {
        Row: {
          created_at: string
          created_by: string | null
          dev_fix_ack_at: string | null
          dev_fix_ack_by: string | null
          dev_followed_up_at: string | null
          dev_followed_up_by: string | null
          dev_followup_source: string | null
          dev_next_followup_at: string | null
          hub_state: string
          id: string
          intercom_conversation_id: string
          linear_assignee: string | null
          linear_canceled_at: string | null
          linear_completed_at: string | null
          linear_created_at: string | null
          linear_key: string | null
          linear_started_at: string | null
          linear_state: string | null
          linear_state_type: string | null
          linear_synced_at: string | null
          linear_title: string | null
          linear_url_override: string | null
          note: string | null
          notified_at: string | null
          owner: string | null
          state_changed_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          dev_fix_ack_at?: string | null
          dev_fix_ack_by?: string | null
          dev_followed_up_at?: string | null
          dev_followed_up_by?: string | null
          dev_followup_source?: string | null
          dev_next_followup_at?: string | null
          hub_state?: string
          id?: string
          intercom_conversation_id: string
          linear_assignee?: string | null
          linear_canceled_at?: string | null
          linear_completed_at?: string | null
          linear_created_at?: string | null
          linear_key?: string | null
          linear_started_at?: string | null
          linear_state?: string | null
          linear_state_type?: string | null
          linear_synced_at?: string | null
          linear_title?: string | null
          linear_url_override?: string | null
          note?: string | null
          notified_at?: string | null
          owner?: string | null
          state_changed_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          dev_fix_ack_at?: string | null
          dev_fix_ack_by?: string | null
          dev_followed_up_at?: string | null
          dev_followed_up_by?: string | null
          dev_followup_source?: string | null
          dev_next_followup_at?: string | null
          hub_state?: string
          id?: string
          intercom_conversation_id?: string
          linear_assignee?: string | null
          linear_canceled_at?: string | null
          linear_completed_at?: string | null
          linear_created_at?: string | null
          linear_key?: string | null
          linear_started_at?: string | null
          linear_state?: string | null
          linear_state_type?: string | null
          linear_synced_at?: string | null
          linear_title?: string | null
          linear_url_override?: string | null
          note?: string | null
          notified_at?: string | null
          owner?: string | null
          state_changed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      esh_backlog_items: {
        Row: {
          area: string | null
          assignee: string | null
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          linked_ref: string | null
          priority: string | null
          source: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          area?: string | null
          assignee?: string | null
          category: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          linked_ref?: string | null
          priority?: string | null
          source?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          area?: string | null
          assignee?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          linked_ref?: string | null
          priority?: string | null
          source?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      esh_lookback_notes: {
        Row: {
          month: string
          note_text: string
          section_key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          month: string
          note_text?: string
          section_key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          month?: string
          note_text?: string
          section_key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      esh_search_index: {
        Row: {
          body: string | null
          idents: string | null
          indexed_at: string
          kind: string
          meta: Json
          ref_id: string
          source_updated_at: string | null
          title: string | null
          tsv: unknown
          url_path: string | null
        }
        Insert: {
          body?: string | null
          idents?: string | null
          indexed_at?: string
          kind: string
          meta?: Json
          ref_id: string
          source_updated_at?: string | null
          title?: string | null
          tsv?: unknown
          url_path?: string | null
        }
        Update: {
          body?: string | null
          idents?: string | null
          indexed_at?: string
          kind?: string
          meta?: Json
          ref_id?: string
          source_updated_at?: string | null
          title?: string | null
          tsv?: unknown
          url_path?: string | null
        }
        Relationships: []
      }
      esh_ticket_actions: {
        Row: {
          action: string
          actor_email: string | null
          actor_intercom_admin_id: string | null
          actor_teammate_name: string | null
          actor_user_id: string | null
          created_at: string
          error: string | null
          id: string
          intercom_conversation_id: string
          intercom_response: Json | null
          intercom_status: number | null
          outcome: string
          payload: Json
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_intercom_admin_id?: string | null
          actor_teammate_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          intercom_conversation_id: string
          intercom_response?: Json | null
          intercom_status?: number | null
          outcome: string
          payload?: Json
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_intercom_admin_id?: string | null
          actor_teammate_name?: string | null
          actor_user_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          intercom_conversation_id?: string
          intercom_response?: Json | null
          intercom_status?: number | null
          outcome?: string
          payload?: Json
        }
        Relationships: []
      }
      esh_trend_notes: {
        Row: {
          metric_key: string
          note_text: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          metric_key: string
          note_text?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          metric_key?: string
          note_text?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      float_coverage_shifts: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          display_name: string
          end_time: string
          ends_on: string
          id: string
          note: string | null
          slack_user_id: string
          start_time: string
          starts_on: string
          time_zone: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          display_name: string
          end_time: string
          ends_on: string
          id?: string
          note?: string | null
          slack_user_id: string
          start_time: string
          starts_on: string
          time_zone?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          display_name?: string
          end_time?: string
          ends_on?: string
          id?: string
          note?: string | null
          slack_user_id?: string
          start_time?: string
          starts_on?: string
          time_zone?: string
          updated_at?: string
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
      gmail_oauth_states: {
        Row: {
          consumed_at: string | null
          created_at: string
          created_by: string | null
          state: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          state: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          created_by?: string | null
          state?: string
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
      hub_members: {
        Row: {
          added_by: string | null
          blocked_at: string | null
          blocked_by: string | null
          created_at: string
          email: string
          first_seen_at: string | null
          id: string
          last_seen_at: string | null
          note: string | null
          provisioned_at: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          added_by?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          created_at?: string
          email: string
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          note?: string | null
          provisioned_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          added_by?: string | null
          blocked_at?: string | null
          blocked_by?: string | null
          created_at?: string
          email?: string
          first_seen_at?: string | null
          id?: string
          last_seen_at?: string | null
          note?: string | null
          provisioned_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      inbox_v2_tickets: {
        Row: {
          classification: string | null
          contact_email: string | null
          contact_name: string | null
          created_at: string
          csat_rated_at: string | null
          csat_rating: number | null
          csat_remark: string | null
          engagement_ai_at: string | null
          engagement_ai_guess: string | null
          engagement_ai_reason: string | null
          engagement_override: string | null
          engagement_override_at: string | null
          engagement_override_by: string | null
          id: string
          intercom_conversation_id: string
          intercom_created_at: string | null
          intercom_updated_at: string | null
          last_synced_at: string
          owner: string | null
          product_area: string | null
          raw_payload: Json | null
          status: string | null
          subject: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          classification?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          csat_rated_at?: string | null
          csat_rating?: number | null
          csat_remark?: string | null
          engagement_ai_at?: string | null
          engagement_ai_guess?: string | null
          engagement_ai_reason?: string | null
          engagement_override?: string | null
          engagement_override_at?: string | null
          engagement_override_by?: string | null
          id?: string
          intercom_conversation_id: string
          intercom_created_at?: string | null
          intercom_updated_at?: string | null
          last_synced_at?: string
          owner?: string | null
          product_area?: string | null
          raw_payload?: Json | null
          status?: string | null
          subject?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          classification?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          csat_rated_at?: string | null
          csat_rating?: number | null
          csat_remark?: string | null
          engagement_ai_at?: string | null
          engagement_ai_guess?: string | null
          engagement_ai_reason?: string | null
          engagement_override?: string | null
          engagement_override_at?: string | null
          engagement_override_by?: string | null
          id?: string
          intercom_conversation_id?: string
          intercom_created_at?: string | null
          intercom_updated_at?: string | null
          last_synced_at?: string
          owner?: string | null
          product_area?: string | null
          raw_payload?: Json | null
          status?: string | null
          subject?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      incidents: {
        Row: {
          declared_at: string
          first_seen_at: string
          id: string
          incident_channel_id: string | null
          incident_channel_name: string | null
          incident_number: number
          incident_url: string | null
          internal_status_url: string | null
          is_customer_impacting: boolean
          last_synced_at: string
          last_update_at: string | null
          raw: Json | null
          reference: string | null
          resolved_at: string | null
          severity: string | null
          severity_rank: number | null
          slack_channel_id: string
          slack_message_ts: string
          status: string | null
          status_category: string
          status_page_url: string | null
          title: string
        }
        Insert: {
          declared_at: string
          first_seen_at?: string
          id?: string
          incident_channel_id?: string | null
          incident_channel_name?: string | null
          incident_number: number
          incident_url?: string | null
          internal_status_url?: string | null
          is_customer_impacting?: boolean
          last_synced_at?: string
          last_update_at?: string | null
          raw?: Json | null
          reference?: string | null
          resolved_at?: string | null
          severity?: string | null
          severity_rank?: number | null
          slack_channel_id: string
          slack_message_ts: string
          status?: string | null
          status_category?: string
          status_page_url?: string | null
          title: string
        }
        Update: {
          declared_at?: string
          first_seen_at?: string
          id?: string
          incident_channel_id?: string | null
          incident_channel_name?: string | null
          incident_number?: number
          incident_url?: string | null
          internal_status_url?: string | null
          is_customer_impacting?: boolean
          last_synced_at?: string
          last_update_at?: string | null
          raw?: Json | null
          reference?: string | null
          resolved_at?: string | null
          severity?: string | null
          severity_rank?: number | null
          slack_channel_id?: string
          slack_message_ts?: string
          status?: string | null
          status_category?: string
          status_page_url?: string | null
          title?: string
        }
        Relationships: []
      }
      integration_health: {
        Row: {
          consecutive_failures: number
          integration: string
          last_alerted_at: string | null
          last_alerted_status: string | null
          last_error: string | null
          last_failure_at: string | null
          last_status: string | null
          last_success_at: string | null
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          integration: string
          last_alerted_at?: string | null
          last_alerted_status?: string | null
          last_error?: string | null
          last_failure_at?: string | null
          last_status?: string | null
          last_success_at?: string | null
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          integration?: string
          last_alerted_at?: string | null
          last_alerted_status?: string | null
          last_error?: string | null
          last_failure_at?: string | null
          last_status?: string | null
          last_success_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      intercom_field_options: {
        Row: {
          active: boolean
          attr_key: string
          first_seen_at: string
          last_seen_at: string
          option_value: string
          sort_order: number
        }
        Insert: {
          active?: boolean
          attr_key: string
          first_seen_at?: string
          last_seen_at?: string
          option_value: string
          sort_order?: number
        }
        Update: {
          active?: boolean
          attr_key?: string
          first_seen_at?: string
          last_seen_at?: string
          option_value?: string
          sort_order?: number
        }
        Relationships: []
      }
      intercom_sync_jobs_v3: {
        Row: {
          created_at: string
          cursor_extra: Json | null
          cursor_ts: string | null
          failed: number
          finished_at: string | null
          id: string
          inserted: number
          kind: string
          last_error: string | null
          processed: number
          started_at: string | null
          status: string
          updated_at: string
          updated_count: number
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          created_at?: string
          cursor_extra?: Json | null
          cursor_ts?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          inserted?: number
          kind: string
          last_error?: string | null
          processed?: number
          started_at?: string | null
          status?: string
          updated_at?: string
          updated_count?: number
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          created_at?: string
          cursor_extra?: Json | null
          cursor_ts?: string | null
          failed?: number
          finished_at?: string | null
          id?: string
          inserted?: number
          kind?: string
          last_error?: string | null
          processed?: number
          started_at?: string | null
          status?: string
          updated_at?: string
          updated_count?: number
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      intercom_teams: {
        Row: {
          active: boolean
          first_seen_at: string
          last_seen_at: string
          name: string
          team_id: string
        }
        Insert: {
          active?: boolean
          first_seen_at?: string
          last_seen_at?: string
          name: string
          team_id: string
        }
        Update: {
          active?: boolean
          first_seen_at?: string
          last_seen_at?: string
          name?: string
          team_id?: string
        }
        Relationships: []
      }
      intercom_tickets_v3: {
        Row: {
          active_clock_computed_at: string | null
          active_clock_engine_version: number | null
          admin_assignee_id: string | null
          classification: string | null
          contact_domain: string | null
          contact_email: string | null
          contact_name: string | null
          created_at: string
          csat_rated_at: string | null
          csat_rater_contact_id: string | null
          csat_rater_email: string | null
          csat_rater_external_id: string | null
          csat_rater_is_internal: boolean | null
          csat_rater_name: string | null
          csat_rating: number | null
          csat_remark: string | null
          custom_attributes: Json | null
          customer_confidence: string | null
          customer_key: string | null
          customer_kind: string | null
          customer_override_at: string | null
          customer_override_by: string | null
          customer_override_key: string | null
          customer_override_reason: string | null
          customer_replied: boolean | null
          customer_resolution_method: string | null
          customer_source: string | null
          eng_wait_end_at: string | null
          eng_wait_source: string | null
          eng_wait_start_at: string | null
          finalized_at: string | null
          first_human_reply_at: string | null
          id: string
          intercom_closed_at: string | null
          intercom_conversation_id: string
          intercom_created_at: string | null
          intercom_updated_at: string | null
          is_test_ticket: boolean
          last_full_fetch_at: string | null
          last_reopened_at: string | null
          last_silent_change: Json | null
          last_synced_at: string | null
          lifecycle_status: string
          outbound_initiated: boolean | null
          owner: string | null
          plan_tier: string
          product_area: string | null
          project_uuid_detected: string | null
          raw_payload: Json | null
          reassigned_team_id: string | null
          reopen_count: number
          reopen_count_at_finalize: number | null
          resolution_active_bh_s: number | null
          resolution_active_s: number | null
          resolution_closed_s: number | null
          resolution_customer_wait_bh_s: number | null
          resolution_customer_wait_s: number | null
          resolution_eng_wait_bh_s: number | null
          resolution_eng_wait_s: number | null
          resolution_window_s: number | null
          responsiveness_computed_at: string | null
          responsiveness_engine_version: number | null
          rsa_override: boolean | null
          silent_update_count: number
          sla_clock_start_at: string | null
          slack_channel_id_detected: string | null
          state: string | null
          subject: string | null
          subject_ai: string | null
          subject_ai_at: string | null
          subject_ai_model: string | null
          subject_ai_source_hash: string | null
          subject_override: string | null
          subject_override_at: string | null
          subject_override_by: string | null
          tags: string[]
          team_assignee_id: string | null
          test_marked_at: string | null
          test_marked_by: string | null
          test_marked_reason: string | null
          time_to_first_admin_reply_s: number | null
          time_to_first_human_reply_bh_s: number | null
          time_to_first_human_reply_s: number | null
          time_to_resolve_s: number | null
          time_to_triage_bh_s: number | null
          time_to_triage_s: number | null
          transferred_at: string | null
          triage_set_at: string | null
          updated_at: string
          workspace_id_detected: string | null
        }
        Insert: {
          active_clock_computed_at?: string | null
          active_clock_engine_version?: number | null
          admin_assignee_id?: string | null
          classification?: string | null
          contact_domain?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          csat_rated_at?: string | null
          csat_rater_contact_id?: string | null
          csat_rater_email?: string | null
          csat_rater_external_id?: string | null
          csat_rater_is_internal?: boolean | null
          csat_rater_name?: string | null
          csat_rating?: number | null
          csat_remark?: string | null
          custom_attributes?: Json | null
          customer_confidence?: string | null
          customer_key?: string | null
          customer_kind?: string | null
          customer_override_at?: string | null
          customer_override_by?: string | null
          customer_override_key?: string | null
          customer_override_reason?: string | null
          customer_replied?: boolean | null
          customer_resolution_method?: string | null
          customer_source?: string | null
          eng_wait_end_at?: string | null
          eng_wait_source?: string | null
          eng_wait_start_at?: string | null
          finalized_at?: string | null
          first_human_reply_at?: string | null
          id?: string
          intercom_closed_at?: string | null
          intercom_conversation_id: string
          intercom_created_at?: string | null
          intercom_updated_at?: string | null
          is_test_ticket?: boolean
          last_full_fetch_at?: string | null
          last_reopened_at?: string | null
          last_silent_change?: Json | null
          last_synced_at?: string | null
          lifecycle_status?: string
          outbound_initiated?: boolean | null
          owner?: string | null
          plan_tier?: string
          product_area?: string | null
          project_uuid_detected?: string | null
          raw_payload?: Json | null
          reassigned_team_id?: string | null
          reopen_count?: number
          reopen_count_at_finalize?: number | null
          resolution_active_bh_s?: number | null
          resolution_active_s?: number | null
          resolution_closed_s?: number | null
          resolution_customer_wait_bh_s?: number | null
          resolution_customer_wait_s?: number | null
          resolution_eng_wait_bh_s?: number | null
          resolution_eng_wait_s?: number | null
          resolution_window_s?: number | null
          responsiveness_computed_at?: string | null
          responsiveness_engine_version?: number | null
          rsa_override?: boolean | null
          silent_update_count?: number
          sla_clock_start_at?: string | null
          slack_channel_id_detected?: string | null
          state?: string | null
          subject?: string | null
          subject_ai?: string | null
          subject_ai_at?: string | null
          subject_ai_model?: string | null
          subject_ai_source_hash?: string | null
          subject_override?: string | null
          subject_override_at?: string | null
          subject_override_by?: string | null
          tags?: string[]
          team_assignee_id?: string | null
          test_marked_at?: string | null
          test_marked_by?: string | null
          test_marked_reason?: string | null
          time_to_first_admin_reply_s?: number | null
          time_to_first_human_reply_bh_s?: number | null
          time_to_first_human_reply_s?: number | null
          time_to_resolve_s?: number | null
          time_to_triage_bh_s?: number | null
          time_to_triage_s?: number | null
          transferred_at?: string | null
          triage_set_at?: string | null
          updated_at?: string
          workspace_id_detected?: string | null
        }
        Update: {
          active_clock_computed_at?: string | null
          active_clock_engine_version?: number | null
          admin_assignee_id?: string | null
          classification?: string | null
          contact_domain?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          csat_rated_at?: string | null
          csat_rater_contact_id?: string | null
          csat_rater_email?: string | null
          csat_rater_external_id?: string | null
          csat_rater_is_internal?: boolean | null
          csat_rater_name?: string | null
          csat_rating?: number | null
          csat_remark?: string | null
          custom_attributes?: Json | null
          customer_confidence?: string | null
          customer_key?: string | null
          customer_kind?: string | null
          customer_override_at?: string | null
          customer_override_by?: string | null
          customer_override_key?: string | null
          customer_override_reason?: string | null
          customer_replied?: boolean | null
          customer_resolution_method?: string | null
          customer_source?: string | null
          eng_wait_end_at?: string | null
          eng_wait_source?: string | null
          eng_wait_start_at?: string | null
          finalized_at?: string | null
          first_human_reply_at?: string | null
          id?: string
          intercom_closed_at?: string | null
          intercom_conversation_id?: string
          intercom_created_at?: string | null
          intercom_updated_at?: string | null
          is_test_ticket?: boolean
          last_full_fetch_at?: string | null
          last_reopened_at?: string | null
          last_silent_change?: Json | null
          last_synced_at?: string | null
          lifecycle_status?: string
          outbound_initiated?: boolean | null
          owner?: string | null
          plan_tier?: string
          product_area?: string | null
          project_uuid_detected?: string | null
          raw_payload?: Json | null
          reassigned_team_id?: string | null
          reopen_count?: number
          reopen_count_at_finalize?: number | null
          resolution_active_bh_s?: number | null
          resolution_active_s?: number | null
          resolution_closed_s?: number | null
          resolution_customer_wait_bh_s?: number | null
          resolution_customer_wait_s?: number | null
          resolution_eng_wait_bh_s?: number | null
          resolution_eng_wait_s?: number | null
          resolution_window_s?: number | null
          responsiveness_computed_at?: string | null
          responsiveness_engine_version?: number | null
          rsa_override?: boolean | null
          silent_update_count?: number
          sla_clock_start_at?: string | null
          slack_channel_id_detected?: string | null
          state?: string | null
          subject?: string | null
          subject_ai?: string | null
          subject_ai_at?: string | null
          subject_ai_model?: string | null
          subject_ai_source_hash?: string | null
          subject_override?: string | null
          subject_override_at?: string | null
          subject_override_by?: string | null
          tags?: string[]
          team_assignee_id?: string | null
          test_marked_at?: string | null
          test_marked_by?: string | null
          test_marked_reason?: string | null
          time_to_first_admin_reply_s?: number | null
          time_to_first_human_reply_bh_s?: number | null
          time_to_first_human_reply_s?: number | null
          time_to_resolve_s?: number | null
          time_to_triage_bh_s?: number | null
          time_to_triage_s?: number | null
          transferred_at?: string | null
          triage_set_at?: string | null
          updated_at?: string
          workspace_id_detected?: string | null
        }
        Relationships: []
      }
      intercom_webhook_failures: {
        Row: {
          created_at: string
          error: string
          id: string
          intercom_conversation_id: string | null
          payload: Json
          replay_ok: boolean | null
          replayed_at: string | null
          topic: string | null
        }
        Insert: {
          created_at?: string
          error: string
          id?: string
          intercom_conversation_id?: string | null
          payload: Json
          replay_ok?: boolean | null
          replayed_at?: string | null
          topic?: string | null
        }
        Update: {
          created_at?: string
          error?: string
          id?: string
          intercom_conversation_id?: string | null
          payload?: Json
          replay_ok?: boolean | null
          replayed_at?: string | null
          topic?: string | null
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
      monthly_insights: {
        Row: {
          buckets: Json
          generated_at: string
          id: string
          month: string
          overall_summary: string
          product_area_summary: Json
          source: string
          ticket_count: number
        }
        Insert: {
          buckets?: Json
          generated_at?: string
          id?: string
          month: string
          overall_summary?: string
          product_area_summary?: Json
          source?: string
          ticket_count?: number
        }
        Update: {
          buckets?: Json
          generated_at?: string
          id?: string
          month?: string
          overall_summary?: string
          product_area_summary?: Json
          source?: string
          ticket_count?: number
        }
        Relationships: []
      }
      new_ticket_alerts: {
        Row: {
          created_at: string
          intercom_conversation_id: string
          slack_channel_id: string
          slack_ts: string | null
        }
        Insert: {
          created_at?: string
          intercom_conversation_id: string
          slack_channel_id: string
          slack_ts?: string | null
        }
        Update: {
          created_at?: string
          intercom_conversation_id?: string
          slack_channel_id?: string
          slack_ts?: string | null
        }
        Relationships: []
      }
      parahelp_routing_sync: {
        Row: {
          account_key: string | null
          attempts: number
          completed_at: string | null
          completed_by: string | null
          created_at: string
          domain: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          note: string | null
          pushed_at: string | null
          source: string
          state: string
          updated_at: string
        }
        Insert: {
          account_key?: string | null
          attempts?: number
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          domain: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          note?: string | null
          pushed_at?: string | null
          source?: string
          state?: string
          updated_at?: string
        }
        Update: {
          account_key?: string | null
          attempts?: number
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          domain?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          note?: string | null
          pushed_at?: string | null
          source?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      pax_investigations: {
        Row: {
          created_at: string
          intercom_conversation_id: string
          note_error: string | null
          note_linked_at: string | null
          note_state: string
          requested_by: string | null
          requested_by_email: string | null
          requested_by_name: string | null
          slack_channel_id: string
          slack_permalink: string | null
          slack_thread_ts: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          intercom_conversation_id: string
          note_error?: string | null
          note_linked_at?: string | null
          note_state?: string
          requested_by?: string | null
          requested_by_email?: string | null
          requested_by_name?: string | null
          slack_channel_id: string
          slack_permalink?: string | null
          slack_thread_ts: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          intercom_conversation_id?: string
          note_error?: string | null
          note_linked_at?: string | null
          note_state?: string
          requested_by?: string | null
          requested_by_email?: string | null
          requested_by_name?: string | null
          slack_channel_id?: string
          slack_permalink?: string | null
          slack_thread_ts?: string
          updated_at?: string
        }
        Relationships: []
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
      relay_attribution_gaps: {
        Row: {
          first_seen_at: string
          last_conversation_id: string | null
          last_seen_at: string
          occurrences: number
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          slack_display_name: string | null
          slack_email: string | null
          slack_user_id: string
        }
        Insert: {
          first_seen_at?: string
          last_conversation_id?: string | null
          last_seen_at?: string
          occurrences?: number
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          slack_display_name?: string | null
          slack_email?: string | null
          slack_user_id: string
        }
        Update: {
          first_seen_at?: string
          last_conversation_id?: string | null
          last_seen_at?: string
          occurrences?: number
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          slack_display_name?: string | null
          slack_email?: string | null
          slack_user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          admin_owner_map: string
          auto_mark_employee_test: boolean
          created_at: string
          esh_write_allowed_actions: string[]
          esh_write_enabled: boolean
          gmail_last_polled_at: string | null
          id: string
          intercom_assignee_id: string
          intercom_inbox_id: string
          last_polled_intercom_at: string | null
          last_polled_ts: string
          monitored_channels: string
          new_ticket_alert_mentions: string
          notion_registry_changed_at: string | null
          notion_registry_domain_count: number | null
          notion_registry_hash: string | null
          notion_registry_page_id: string
          notion_registry_synced_at: string | null
          pax_help_channel_id: string | null
          pax_request_template: string | null
          pax_slack_user_id: string | null
          product_areas: string
          severity_ai_daily_call_cap: number
          severity_ai_enabled: boolean
          slack_bot_user_id: string
          sse_intercom_inbox_id: string
          subject_ai_daily_call_cap: number
          subject_ai_enabled: boolean
          test_intercom_inbox_id: string
          testing_mode: boolean
          updated_at: string
        }
        Insert: {
          admin_owner_map?: string
          auto_mark_employee_test?: boolean
          created_at?: string
          esh_write_allowed_actions?: string[]
          esh_write_enabled?: boolean
          gmail_last_polled_at?: string | null
          id?: string
          intercom_assignee_id?: string
          intercom_inbox_id?: string
          last_polled_intercom_at?: string | null
          last_polled_ts?: string
          monitored_channels?: string
          new_ticket_alert_mentions?: string
          notion_registry_changed_at?: string | null
          notion_registry_domain_count?: number | null
          notion_registry_hash?: string | null
          notion_registry_page_id?: string
          notion_registry_synced_at?: string | null
          pax_help_channel_id?: string | null
          pax_request_template?: string | null
          pax_slack_user_id?: string | null
          product_areas?: string
          severity_ai_daily_call_cap?: number
          severity_ai_enabled?: boolean
          slack_bot_user_id?: string
          sse_intercom_inbox_id?: string
          subject_ai_daily_call_cap?: number
          subject_ai_enabled?: boolean
          test_intercom_inbox_id?: string
          testing_mode?: boolean
          updated_at?: string
        }
        Update: {
          admin_owner_map?: string
          auto_mark_employee_test?: boolean
          created_at?: string
          esh_write_allowed_actions?: string[]
          esh_write_enabled?: boolean
          gmail_last_polled_at?: string | null
          id?: string
          intercom_assignee_id?: string
          intercom_inbox_id?: string
          last_polled_intercom_at?: string | null
          last_polled_ts?: string
          monitored_channels?: string
          new_ticket_alert_mentions?: string
          notion_registry_changed_at?: string | null
          notion_registry_domain_count?: number | null
          notion_registry_hash?: string | null
          notion_registry_page_id?: string
          notion_registry_synced_at?: string | null
          pax_help_channel_id?: string | null
          pax_request_template?: string | null
          pax_slack_user_id?: string | null
          product_areas?: string
          severity_ai_daily_call_cap?: number
          severity_ai_enabled?: boolean
          slack_bot_user_id?: string
          sse_intercom_inbox_id?: string
          subject_ai_daily_call_cap?: number
          subject_ai_enabled?: boolean
          test_intercom_inbox_id?: string
          testing_mode?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      severity_eval_items: {
        Row: {
          adjudicated_at: string | null
          adjudicated_by: string | null
          adjudication_note: string | null
          ai_severity: number | null
          confidence: string | null
          created_at: string
          error: string | null
          evidence: string | null
          human_severity: number | null
          id: string
          input_excerpt: string | null
          intercom_conversation_id: string
          rationale: string | null
          run_id: string
          subject: string | null
          verdict: string
        }
        Insert: {
          adjudicated_at?: string | null
          adjudicated_by?: string | null
          adjudication_note?: string | null
          ai_severity?: number | null
          confidence?: string | null
          created_at?: string
          error?: string | null
          evidence?: string | null
          human_severity?: number | null
          id?: string
          input_excerpt?: string | null
          intercom_conversation_id: string
          rationale?: string | null
          run_id: string
          subject?: string | null
          verdict?: string
        }
        Update: {
          adjudicated_at?: string | null
          adjudicated_by?: string | null
          adjudication_note?: string | null
          ai_severity?: number | null
          confidence?: string | null
          created_at?: string
          error?: string | null
          evidence?: string | null
          human_severity?: number | null
          id?: string
          input_excerpt?: string | null
          intercom_conversation_id?: string
          rationale?: string | null
          run_id?: string
          subject?: string | null
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "severity_eval_items_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "severity_eval_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      severity_eval_runs: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          model: string | null
          notes: string | null
          pass: string
          requested_n: number
          rubric_version: number | null
          scored_n: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          model?: string | null
          notes?: string | null
          pass?: string
          requested_n?: number
          rubric_version?: number | null
          scored_n?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          model?: string | null
          notes?: string | null
          pass?: string
          requested_n?: number
          rubric_version?: number | null
          scored_n?: number
        }
        Relationships: []
      }
      severity_proposals: {
        Row: {
          confidence: string
          content_hash: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          evidence: string | null
          final_severity: number | null
          id: string
          input_chars: number | null
          input_excerpt: string | null
          input_tokens: number | null
          intercom_conversation_id: string
          model: string | null
          output_tokens: number | null
          override_reason_code: string | null
          override_reason_note: string | null
          pass: string
          proposed_severity: number
          rationale: string
          rubric_version: number | null
          status: string
          updated_at: string
        }
        Insert: {
          confidence: string
          content_hash: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          evidence?: string | null
          final_severity?: number | null
          id?: string
          input_chars?: number | null
          input_excerpt?: string | null
          input_tokens?: number | null
          intercom_conversation_id: string
          model?: string | null
          output_tokens?: number | null
          override_reason_code?: string | null
          override_reason_note?: string | null
          pass: string
          proposed_severity: number
          rationale?: string
          rubric_version?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          confidence?: string
          content_hash?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          evidence?: string | null
          final_severity?: number | null
          id?: string
          input_chars?: number | null
          input_excerpt?: string | null
          input_tokens?: number | null
          intercom_conversation_id?: string
          model?: string | null
          output_tokens?: number | null
          override_reason_code?: string | null
          override_reason_note?: string | null
          pass?: string
          proposed_severity?: number
          rationale?: string
          rubric_version?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      severity_rubric_versions: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          status?: string
          updated_at?: string
          version: number
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      sla_breach_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          intercom_conversation_id: string
          metric: string
          note: string | null
          reason: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          intercom_conversation_id: string
          metric: string
          note?: string | null
          reason: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          intercom_conversation_id?: string
          metric?: string
          note?: string | null
          reason?: string
        }
        Relationships: []
      }
      sla_policy_targets: {
        Row: {
          clock: string
          created_at: string
          id: string
          metric: string
          severity: number | null
          target_seconds: number | null
          updated_at: string
          version_id: string
        }
        Insert: {
          clock: string
          created_at?: string
          id?: string
          metric: string
          severity?: number | null
          target_seconds?: number | null
          updated_at?: string
          version_id: string
        }
        Update: {
          clock?: string
          created_at?: string
          id?: string
          metric?: string
          severity?: number | null
          target_seconds?: number | null
          updated_at?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_policy_targets_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "sla_policy_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_policy_versions: {
        Row: {
          business_hours: Json
          created_at: string
          created_by: string | null
          effective_from: string
          id: string
          label: string | null
          plan: string
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          business_hours: Json
          created_at?: string
          created_by?: string | null
          effective_from: string
          id?: string
          label?: string | null
          plan?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          business_hours?: Json
          created_at?: string
          created_by?: string | null
          effective_from?: string
          id?: string
          label?: string | null
          plan?: string
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      sla_violation_overrides: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          intercom_conversation_id: string
          metric: string
          note: string | null
          reason: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          intercom_conversation_id: string
          metric: string
          note?: string | null
          reason: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          intercom_conversation_id?: string
          metric?: string
          note?: string | null
          reason?: string
          updated_at?: string
        }
        Relationships: []
      }
      slack_channel_account_map: {
        Row: {
          account_domain: string | null
          account_label: string
          channel_name: string | null
          created_at: string
          slack_channel_id: string
          updated_at: string
        }
        Insert: {
          account_domain?: string | null
          account_label: string
          channel_name?: string | null
          created_at?: string
          slack_channel_id: string
          updated_at?: string
        }
        Update: {
          account_domain?: string | null
          account_label?: string
          channel_name?: string | null
          created_at?: string
          slack_channel_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      slack_event_claims: {
        Row: {
          channel_id: string | null
          claimed_at: string
          completed_at: string | null
          event_id: string
          event_type: string | null
          status: string
        }
        Insert: {
          channel_id?: string | null
          claimed_at?: string
          completed_at?: string | null
          event_id: string
          event_type?: string | null
          status?: string
        }
        Update: {
          channel_id?: string | null
          claimed_at?: string
          completed_at?: string | null
          event_id?: string
          event_type?: string | null
          status?: string
        }
        Relationships: []
      }
      slack_event_failures: {
        Row: {
          channel_id: string | null
          created_at: string
          error: string | null
          event_id: string | null
          event_type: string | null
          id: string
          payload: Json | null
          replayed_at: string | null
        }
        Insert: {
          channel_id?: string | null
          created_at?: string
          error?: string | null
          event_id?: string | null
          event_type?: string | null
          id?: string
          payload?: Json | null
          replayed_at?: string | null
        }
        Update: {
          channel_id?: string | null
          created_at?: string
          error?: string | null
          event_id?: string | null
          event_type?: string | null
          id?: string
          payload?: Json | null
          replayed_at?: string | null
        }
        Relationships: []
      }
      teammates: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          id: string
          intercom_admin_id: string | null
          name: string
          role: string
          show_dashboard: boolean
          slack_user_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          intercom_admin_id?: string | null
          name: string
          role: string
          show_dashboard?: boolean
          slack_user_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          intercom_admin_id?: string | null
          name?: string
          role?: string
          show_dashboard?: boolean
          slack_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      v3_channel_account_map: {
        Row: {
          account_key: string
          created_at: string
          label: string | null
          slack_channel_id: string
          updated_at: string
        }
        Insert: {
          account_key: string
          created_at?: string
          label?: string | null
          slack_channel_id: string
          updated_at?: string
        }
        Update: {
          account_key?: string
          created_at?: string
          label?: string | null
          slack_channel_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "v3_channel_account_map_account_key_fkey"
            columns: ["account_key"]
            isOneToOne: false
            referencedRelation: "v3_customer_accounts"
            referencedColumns: ["account_key"]
          },
        ]
      }
      v3_channel_account_proposals: {
        Row: {
          channel_name: string | null
          confidence: string
          created_at: string
          evidence: string
          id: string
          proposed_account_key: string
          slack_channel_id: string
          status: string
          updated_at: string
        }
        Insert: {
          channel_name?: string | null
          confidence: string
          created_at?: string
          evidence: string
          id?: string
          proposed_account_key: string
          slack_channel_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          channel_name?: string | null
          confidence?: string
          created_at?: string
          evidence?: string
          id?: string
          proposed_account_key?: string
          slack_channel_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "v3_channel_account_proposals_proposed_account_key_fkey"
            columns: ["proposed_account_key"]
            isOneToOne: false
            referencedRelation: "v3_customer_accounts"
            referencedColumns: ["account_key"]
          },
        ]
      }
      v3_closed_won_acknowledged_names: {
        Row: {
          acknowledged_at: string
          acknowledged_by: string | null
          acknowledged_by_email: string | null
          display_name: string
          name_key: string
          note: string | null
        }
        Insert: {
          acknowledged_at?: string
          acknowledged_by?: string | null
          acknowledged_by_email?: string | null
          display_name: string
          name_key: string
          note?: string | null
        }
        Update: {
          acknowledged_at?: string
          acknowledged_by?: string | null
          acknowledged_by_email?: string | null
          display_name?: string
          name_key?: string
          note?: string | null
        }
        Relationships: []
      }
      v3_coverage_snapshots: {
        Row: {
          attributed: number
          created_at: string
          excluded_not_enterprise: number
          excluded_prospect_personal: number
          excluded_prospect_unmapped: number
          excluded_transferred_out: number
          m_domain: number
          m_orphan_override: number
          m_override: number
          m_slack_channel: number
          m_unresolved: number
          m_workspace_id: number
          pct_attributed: number
          snapshot_date: string
          total_tickets: number
          unattributed: number
          updated_at: string
        }
        Insert: {
          attributed?: number
          created_at?: string
          excluded_not_enterprise?: number
          excluded_prospect_personal?: number
          excluded_prospect_unmapped?: number
          excluded_transferred_out?: number
          m_domain?: number
          m_orphan_override?: number
          m_override?: number
          m_slack_channel?: number
          m_unresolved?: number
          m_workspace_id?: number
          pct_attributed?: number
          snapshot_date: string
          total_tickets?: number
          unattributed?: number
          updated_at?: string
        }
        Update: {
          attributed?: number
          created_at?: string
          excluded_not_enterprise?: number
          excluded_prospect_personal?: number
          excluded_prospect_unmapped?: number
          excluded_transferred_out?: number
          m_domain?: number
          m_orphan_override?: number
          m_override?: number
          m_slack_channel?: number
          m_unresolved?: number
          m_workspace_id?: number
          pct_attributed?: number
          snapshot_date?: string
          total_tickets?: number
          unattributed?: number
          updated_at?: string
        }
        Relationships: []
      }
      v3_customer_accounts: {
        Row: {
          account_key: string
          aliases: string[] | null
          created_at: string
          csm_owner: string | null
          domains: string[]
          is_test: boolean
          label: string
          notes: string | null
          status: string | null
          tier: string | null
          updated_at: string
        }
        Insert: {
          account_key: string
          aliases?: string[] | null
          created_at?: string
          csm_owner?: string | null
          domains?: string[]
          is_test?: boolean
          label: string
          notes?: string | null
          status?: string | null
          tier?: string | null
          updated_at?: string
        }
        Update: {
          account_key?: string
          aliases?: string[] | null
          created_at?: string
          csm_owner?: string | null
          domains?: string[]
          is_test?: boolean
          label?: string
          notes?: string | null
          status?: string | null
          tier?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      v3_internal_channels: {
        Row: {
          channel_name: string
          created_at: string
          note: string | null
          slack_channel_id: string
          updated_at: string
        }
        Insert: {
          channel_name: string
          created_at?: string
          note?: string | null
          slack_channel_id: string
          updated_at?: string
        }
        Update: {
          channel_name?: string
          created_at?: string
          note?: string | null
          slack_channel_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      v3_personal_email_domains: {
        Row: {
          created_at: string
          domain: string
        }
        Insert: {
          created_at?: string
          domain: string
        }
        Update: {
          created_at?: string
          domain?: string
        }
        Relationships: []
      }
      v3_ticket_attributes: {
        Row: {
          attr_key: string
          attr_value_bool: boolean | null
          attr_value_num: number | null
          attr_value_text: string | null
          id: string
          synced_at: string
          ticket_id: string
        }
        Insert: {
          attr_key: string
          attr_value_bool?: boolean | null
          attr_value_num?: number | null
          attr_value_text?: string | null
          id?: string
          synced_at?: string
          ticket_id: string
        }
        Update: {
          attr_key?: string
          attr_value_bool?: boolean | null
          attr_value_num?: number | null
          attr_value_text?: string | null
          id?: string
          synced_at?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "v3_ticket_attributes_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "intercom_tickets_v3"
            referencedColumns: ["id"]
          },
        ]
      }
      v3_workspace_customer_map: {
        Row: {
          account_key: string
          created_at: string
          resolved_at: string
          source: string
          tier: string | null
          updated_at: string
          workspace_id: string
          workspace_name: string | null
        }
        Insert: {
          account_key: string
          created_at?: string
          resolved_at?: string
          source?: string
          tier?: string | null
          updated_at?: string
          workspace_id: string
          workspace_name?: string | null
        }
        Update: {
          account_key?: string
          created_at?: string
          resolved_at?: string
          source?: string
          tier?: string | null
          updated_at?: string
          workspace_id?: string
          workspace_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "v3_workspace_customer_map_account_key_fkey"
            columns: ["account_key"]
            isOneToOne: false
            referencedRelation: "v3_customer_accounts"
            referencedColumns: ["account_key"]
          },
        ]
      }
    }
    Views: {
      v3_channel_names: {
        Row: {
          channel_name: string | null
          slack_channel_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      auto_close_gmail_threads: { Args: never; Returns: undefined }
      backfill_v3_customer_keys: {
        Args: { _batch?: number; _force?: boolean }
        Returns: {
          updated_count: number
        }[]
      }
      can_edit: { Args: { _uid: string }; Returns: boolean }
      claim_intercom_part: {
        Args: { p_mapping_id: string; p_part_id: string }
        Returns: boolean
      }
      claim_slack_event: {
        Args: { p_event_ts: string; p_mapping_id: string }
        Returns: boolean
      }
      esh_cron_headers: { Args: never; Returns: Json }
      esh_cron_jobs: {
        Args: never
        Returns: {
          active: boolean
          command_summary: string
          jobname: string
          last_message: string
          last_run_at: string
          last_status: string
          schedule: string
        }[]
      }
      esh_deep_search: {
        Args: { p_kinds?: string[]; p_limit?: number; p_q: string }
        Returns: {
          kind: string
          match_mode: string
          meta: Json
          rank: number
          ref_id: string
          snippet: string
          source_updated_at: string
          title: string
          url_path: string
        }[]
      }
      esh_refresh_search_index: {
        Args: { p_kinds?: string[] }
        Returns: {
          kind: string
          rows_indexed: number
        }[]
      }
      esh_strip_html: { Args: { t: string }; Returns: string }
      gmail_connection_status: {
        Args: never
        Returns: {
          connected: boolean
          email_address: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      list_users_with_roles: {
        Args: never
        Returns: {
          created_at: string
          email: string
          id: string
          roles: string[]
        }[]
      }
      search_conversations: {
        Args: { search_term: string }
        Returns: {
          result_id: string
          result_source: string
        }[]
      }
      severity_override_reason_rollup: {
        Args: { _since?: string }
        Returns: {
          last_seen: string
          occurrences: number
          reason_code: string
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      v3_accounts_usage: {
        Args: never
        Returns: {
          account_key: string
          ticket_count: number
        }[]
      }
      v3_capture_coverage_snapshot: {
        Args: never
        Returns: {
          attributed: number
          created_at: string
          excluded_not_enterprise: number
          excluded_prospect_personal: number
          excluded_prospect_unmapped: number
          excluded_transferred_out: number
          m_domain: number
          m_orphan_override: number
          m_override: number
          m_slack_channel: number
          m_unresolved: number
          m_workspace_id: number
          pct_attributed: number
          snapshot_date: string
          total_tickets: number
          unattributed: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "v3_coverage_snapshots"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      v3_channel_proposals_pending: {
        Args: never
        Returns: {
          account_label: string
          channel_name: string
          confidence: string
          evidence: string
          proposed_account_key: string
          slack_channel_id: string
          ticket_count: number
        }[]
      }
      v3_channels_usage: {
        Args: never
        Returns: {
          account_key: string
          account_label: string
          channel_name: string
          slack_channel_id: string
          status: string
          ticket_count: number
        }[]
      }
      v3_coverage_cached: {
        Args: { max_age_minutes?: number }
        Returns: {
          as_of: string
          attributed: number
          excluded_not_enterprise: number
          excluded_prospect_personal: number
          excluded_prospect_unmapped: number
          excluded_transferred_out: number
          from_cache: boolean
          m_domain: number
          m_orphan_override: number
          m_override: number
          m_slack_channel: number
          m_unresolved: number
          m_workspace_id: number
          orphan_overrides: number
          pct_attributed: number
          population: number
          total_tickets: number
          unattributed: number
        }[]
      }
      v3_coverage_current: {
        Args: never
        Returns: {
          attributed: number
          excluded_not_enterprise: number
          excluded_prospect_personal: number
          excluded_prospect_unmapped: number
          excluded_transferred_out: number
          m_domain: number
          m_orphan_override: number
          m_override: number
          m_slack_channel: number
          m_unresolved: number
          m_workspace_id: number
          orphan_overrides: number
          pct_attributed: number
          population: number
          total_tickets: number
          unattributed: number
        }[]
      }
      v3_derive_customer: {
        Args: {
          _contact_domain?: string
          _contact_email: string
          _override_key: string
          _slack_channel_id_detected?: string
          _tags?: string[]
          _workspace_id_detected?: string
        }
        Returns: {
          customer_confidence: string
          customer_key: string
          customer_kind: string
          customer_resolution_method: string
          customer_source: string
        }[]
      }
      v3_generate_channel_proposals: { Args: never; Returns: number }
      v3_no_signal_tickets: {
        Args: never
        Returns: {
          contact_domain: string
          contact_email: string
          id: string
          intercom_conversation_id: string
          intercom_created_at: string
          last_full_fetch_at: string
          slack_channel_id_detected: string
          subject: string
          workspace_id_detected: string
        }[]
      }
      v3_orphan_override_suggestions: {
        Args: never
        Returns: {
          match_kind: string
          orphan_key: string
          suggested_account_key: string
          suggested_label: string
          ticket_count: number
        }[]
      }
      v3_orphan_overrides: {
        Args: never
        Returns: {
          customer_key: string
          ticket_count: number
        }[]
      }
      v3_personal_unlabeled_tickets: {
        Args: never
        Returns: {
          contact_domain: string
          contact_email: string
          id: string
          intercom_conversation_id: string
          intercom_created_at: string
          last_full_fetch_at: string
          slack_channel_id_detected: string
          subject: string
          workspace_id_detected: string
        }[]
      }
      v3_severity_eval_sample: {
        Args: { _n?: number }
        Returns: {
          conversation_id: string
          human_severity: number
          ticket_subject: string
        }[]
      }
      v3_tickets_for_channel: {
        Args: { _channel_id: string }
        Returns: {
          customer_key: string
          customer_resolution_method: string
          id: string
          intercom_conversation_id: string
          intercom_created_at: string
          subject: string
          total_count: number
        }[]
      }
      v3_tickets_for_override_key: {
        Args: { _key: string }
        Returns: {
          customer_key: string
          customer_resolution_method: string
          id: string
          intercom_conversation_id: string
          intercom_created_at: string
          subject: string
          total_count: number
        }[]
      }
      v3_unattributed_groups: {
        Args: never
        Returns: {
          display_name: string
          group_key: string
          group_kind: string
          ticket_count: number
        }[]
      }
      v3_unattributed_sync_status: {
        Args: never
        Returns: {
          next_full_fetch_at: string
          pending_closed: number
          pending_open: number
          schedule_desc: string
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user" | "editor"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "editor"],
    },
  },
} as const
