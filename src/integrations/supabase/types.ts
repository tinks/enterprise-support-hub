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
      intercom_tickets_v3: {
        Row: {
          admin_assignee_id: string | null
          classification: string | null
          contact_domain: string | null
          contact_email: string | null
          contact_name: string | null
          created_at: string
          csat_rated_at: string | null
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
          customer_resolution_method: string | null
          customer_source: string | null
          finalized_at: string | null
          id: string
          intercom_closed_at: string | null
          intercom_conversation_id: string
          intercom_created_at: string | null
          intercom_updated_at: string | null
          last_full_fetch_at: string | null
          last_reopened_at: string | null
          last_silent_change: Json | null
          last_synced_at: string | null
          lifecycle_status: string
          owner: string | null
          product_area: string | null
          project_uuid_detected: string | null
          raw_payload: Json | null
          reassigned_team_id: string | null
          reopen_count: number
          reopen_count_at_finalize: number | null
          rsa_override: boolean | null
          silent_update_count: number
          slack_channel_id_detected: string | null
          state: string | null
          subject: string | null
          tags: string[]
          team_assignee_id: string | null
          time_to_first_admin_reply_s: number | null
          time_to_resolve_s: number | null
          transferred_at: string | null
          updated_at: string
          workspace_id_detected: string | null
        }
        Insert: {
          admin_assignee_id?: string | null
          classification?: string | null
          contact_domain?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          csat_rated_at?: string | null
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
          customer_resolution_method?: string | null
          customer_source?: string | null
          finalized_at?: string | null
          id?: string
          intercom_closed_at?: string | null
          intercom_conversation_id: string
          intercom_created_at?: string | null
          intercom_updated_at?: string | null
          last_full_fetch_at?: string | null
          last_reopened_at?: string | null
          last_silent_change?: Json | null
          last_synced_at?: string | null
          lifecycle_status?: string
          owner?: string | null
          product_area?: string | null
          project_uuid_detected?: string | null
          raw_payload?: Json | null
          reassigned_team_id?: string | null
          reopen_count?: number
          reopen_count_at_finalize?: number | null
          rsa_override?: boolean | null
          silent_update_count?: number
          slack_channel_id_detected?: string | null
          state?: string | null
          subject?: string | null
          tags?: string[]
          team_assignee_id?: string | null
          time_to_first_admin_reply_s?: number | null
          time_to_resolve_s?: number | null
          transferred_at?: string | null
          updated_at?: string
          workspace_id_detected?: string | null
        }
        Update: {
          admin_assignee_id?: string | null
          classification?: string | null
          contact_domain?: string | null
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          csat_rated_at?: string | null
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
          customer_resolution_method?: string | null
          customer_source?: string | null
          finalized_at?: string | null
          id?: string
          intercom_closed_at?: string | null
          intercom_conversation_id?: string
          intercom_created_at?: string | null
          intercom_updated_at?: string | null
          last_full_fetch_at?: string | null
          last_reopened_at?: string | null
          last_silent_change?: Json | null
          last_synced_at?: string | null
          lifecycle_status?: string
          owner?: string | null
          product_area?: string | null
          project_uuid_detected?: string | null
          raw_payload?: Json | null
          reassigned_team_id?: string | null
          reopen_count?: number
          reopen_count_at_finalize?: number | null
          rsa_override?: boolean | null
          silent_update_count?: number
          slack_channel_id_detected?: string | null
          state?: string | null
          subject?: string | null
          tags?: string[]
          team_assignee_id?: string | null
          time_to_first_admin_reply_s?: number | null
          time_to_resolve_s?: number | null
          transferred_at?: string | null
          updated_at?: string
          workspace_id_detected?: string | null
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
      teammates: {
        Row: {
          active: boolean
          created_at: string
          email: string | null
          id: string
          intercom_admin_id: string
          name: string
          role: string
          show_dashboard: boolean
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          intercom_admin_id: string
          name: string
          role: string
          show_dashboard?: boolean
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string | null
          id?: string
          intercom_admin_id?: string
          name?: string
          role?: string
          show_dashboard?: boolean
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
      claim_intercom_part: {
        Args: { p_mapping_id: string; p_part_id: string }
        Returns: boolean
      }
      claim_slack_event: {
        Args: { p_event_ts: string; p_mapping_id: string }
        Returns: boolean
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
      app_role: "admin" | "user"
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
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
