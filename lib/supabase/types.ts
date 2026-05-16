/**
 * Hand-written Database types. Once the Supabase project is live, regenerate
 * with `npx supabase gen types typescript --project-id <id> > lib/supabase/types.ts`.
 *
 * Format mirrors what the supabase typegen emits — every table has
 * Row / Insert / Update / Relationships keys (the postgrest-js GenericTable
 * shape requires Relationships).
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

type Status = 'pending' | 'processing' | 'done' | 'failed' | 'quota_blocked';
type LlmProvider = 'anthropic' | 'together';
type PrivacyLevel = 'standard' | 'enhanced' | 'strict';
type Language = 'zh' | 'zh-en';
type Plan = 'free' | 'team' | 'business';
type MemberRole = 'owner' | 'admin' | 'member' | 'guest';
type ActionStatus = 'pending' | 'sent' | 'confirmed' | 'done' | 'cancelled';

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: { id: string; name: string; plan: Plan; created_at: string };
        Insert: { id?: string; name: string; plan?: Plan; created_at?: string };
        Update: { id?: string; name?: string; plan?: Plan; created_at?: string };
        Relationships: [];
      };
      members: {
        Row: {
          id: string;
          org_id: string;
          user_id: string | null;
          name: string;
          email: string | null;
          role: MemberRole;
          voice_embedding: number[] | null;
          enrolled_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          user_id?: string | null;
          name: string;
          email?: string | null;
          role?: MemberRole;
          voice_embedding?: number[] | null;
          enrolled_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          org_id?: string;
          user_id?: string | null;
          name?: string;
          email?: string | null;
          role?: MemberRole;
          voice_embedding?: number[] | string | null;
          enrolled_at?: string | null;
        };
        Relationships: [];
      };
      meetings: {
        Row: {
          id: string;
          org_id: string;
          title: string;
          audio_url: string | null;
          duration_seconds: number | null;
          language: Language;
          status: Status;
          privacy_level: PrivacyLevel;
          is_confidential: boolean;
          created_by: string | null;
          created_at: string;
          processed_at: string | null;
          error_message: string | null;
          cost_estimate_cents: number | null;
          llm_input_tokens: number | null;
          llm_output_tokens: number | null;
          stt_backend: 'groq' | 'local' | null;
          gpu_tier: 'a10g' | 'l4' | 'cpu' | null;
          llm_provider: LlmProvider | null;
        };
        Insert: {
          id?: string;
          org_id: string;
          title: string;
          audio_url?: string | null;
          duration_seconds?: number | null;
          language?: Language;
          status?: Status;
          privacy_level?: PrivacyLevel;
          is_confidential?: boolean;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          title?: string;
          audio_url?: string | null;
          duration_seconds?: number | null;
          language?: Language;
          status?: Status;
          privacy_level?: PrivacyLevel;
          is_confidential?: boolean;
          processed_at?: string | null;
          error_message?: string | null;
          cost_estimate_cents?: number | null;
          llm_input_tokens?: number | null;
          llm_output_tokens?: number | null;
          stt_backend?: 'groq' | 'local' | null;
          gpu_tier?: 'a10g' | 'l4' | 'cpu' | null;
          llm_provider?: LlmProvider | null;
        };
        Relationships: [];
      };
      speaker_segments: {
        Row: {
          id: string;
          meeting_id: string;
          speaker_label: string;
          matched_member_id: string | null;
          match_confidence: number | null;
          start_seconds: number;
          end_seconds: number;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          speaker_label: string;
          matched_member_id?: string | null;
          match_confidence?: number | null;
          start_seconds: number;
          end_seconds: number;
        };
        Update: {
          speaker_label?: string;
          matched_member_id?: string | null;
          match_confidence?: number | null;
        };
        Relationships: [];
      };
      transcript_segments: {
        Row: {
          id: string;
          meeting_id: string;
          speaker_label: string | null;
          text: string;
          start_seconds: number;
          end_seconds: number;
          confidence: number | null;
          is_reviewed: boolean;
          has_overlap: boolean;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          speaker_label?: string | null;
          text: string;
          start_seconds: number;
          end_seconds: number;
          confidence?: number | null;
          is_reviewed?: boolean;
          has_overlap?: boolean;
        };
        Update: {
          speaker_label?: string | null;
          text?: string;
          is_reviewed?: boolean;
        };
        Relationships: [];
      };
      topic_segments: {
        Row: {
          id: string;
          meeting_id: string;
          title: string;
          summary: string | null;
          start_seconds: number;
          end_seconds: number;
          ordinal: number;
          embedding: number[] | null;
          cluster_id: string | null;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          title: string;
          summary?: string | null;
          start_seconds: number;
          end_seconds: number;
          ordinal?: number;
          embedding?: number[] | string | null;
          cluster_id?: string | null;
        };
        Update: {
          title?: string;
          summary?: string | null;
          embedding?: number[] | string | null;
          cluster_id?: string | null;
        };
        Relationships: [];
      };
      topic_clusters: {
        Row: {
          id: string;
          org_id: string;
          canonical_title: string;
          centroid: number[] | null;
          member_count: number;
          current_state_summary: Json | null;
          current_state_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          canonical_title: string;
          centroid?: number[] | string | null;
          member_count?: number;
          current_state_summary?: Json | null;
          current_state_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          canonical_title?: string;
          centroid?: number[] | string | null;
          member_count?: number;
          current_state_summary?: Json | null;
          current_state_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      action_items: {
        Row: {
          id: string;
          meeting_id: string;
          topic_segment_id: string | null;
          description: string;
          owner_member_id: string | null;
          owner_raw_name: string | null;
          due_date: string | null;
          due_date_raw: string | null;
          source_quote: string;
          source_start_seconds: number;
          source_speaker: string | null;
          status: ActionStatus;
          confidence: number;
          needs_clarification: string | null;
          created_at: string;
          created_by_member_id: string | null;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          topic_segment_id?: string | null;
          description: string;
          owner_member_id?: string | null;
          owner_raw_name?: string | null;
          due_date?: string | null;
          due_date_raw?: string | null;
          source_quote: string;
          source_start_seconds: number;
          source_speaker?: string | null;
          status?: ActionStatus;
          confidence: number;
          needs_clarification?: string | null;
          created_at?: string;
          created_by_member_id?: string | null;
        };
        Update: {
          status?: ActionStatus;
          owner_member_id?: string | null;
          due_date?: string | null;
          description?: string;
          source_speaker?: string | null;
        };
        Relationships: [];
      };
      decisions: {
        Row: {
          id: string;
          meeting_id: string;
          topic_segment_id: string | null;
          description: string;
          source_quote: string;
          source_start_seconds: number;
          agreed_by_member_ids: string[];
          confidence: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          topic_segment_id?: string | null;
          description: string;
          source_quote: string;
          source_start_seconds: number;
          agreed_by_member_ids?: string[];
          confidence?: number | null;
          created_at?: string;
        };
        Update: { description?: string; confidence?: number | null };
        Relationships: [];
      };
      open_questions: {
        Row: {
          id: string;
          meeting_id: string;
          topic_segment_id: string | null;
          question: string;
          source_quote: string | null;
          source_start_seconds: number | null;
          raised_by_speaker: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          topic_segment_id?: string | null;
          question: string;
          source_quote?: string | null;
          source_start_seconds?: number | null;
          raised_by_speaker?: string | null;
          created_at?: string;
        };
        Update: { question?: string };
        Relationships: [];
      };
      redaction_rules: {
        Row: {
          id: string;
          org_id: string;
          pattern: string;
          is_regex: boolean;
          redaction_label: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id: string;
          pattern: string;
          is_regex?: boolean;
          redaction_label?: string;
          created_at?: string;
        };
        Update: {
          pattern?: string;
          is_regex?: boolean;
          redaction_label?: string;
        };
        Relationships: [];
      };
      quota_usage: {
        Row: {
          id: string;
          org_id: string | null;
          resource_type: string;
          period_start: string;
          count: number;
          updated_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          org_id?: string | null;
          resource_type: string;
          period_start: string;
          count?: number;
          updated_at?: string;
          created_at?: string;
        };
        Update: {
          count?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      quota_alerts_sent: {
        Row: {
          id: string;
          alert_type: string;
          resource_type: string;
          org_id: string | null;
          period_start: string;
          sent_at: string;
        };
        Insert: {
          id?: string;
          alert_type: string;
          resource_type: string;
          org_id?: string | null;
          period_start: string;
          sent_at?: string;
        };
        Update: never;
        Relationships: [];
      };
      meeting_share_links: {
        Row: {
          id: string;
          meeting_id: string;
          org_id: string;
          token: string;
          expires_at: string | null;
          created_by: string | null;
          created_at: string;
          revoked_at: string | null;
          view_count: number;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          org_id: string;
          token: string;
          expires_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          revoked_at?: string | null;
          view_count?: number;
        };
        Update: {
          expires_at?: string | null;
          revoked_at?: string | null;
          view_count?: number;
        };
        Relationships: [];
      };
      email_sends: {
        Row: {
          id: string;
          meeting_id: string;
          sent_by: string | null;
          recipients: string[];
          subject: string;
          resend_message_id: string | null;
          status: 'sent' | 'failed' | 'pending';
          error_message: string | null;
          sent_at: string;
        };
        Insert: {
          id?: string;
          meeting_id: string;
          sent_by?: string | null;
          recipients: string[];
          subject: string;
          resend_message_id?: string | null;
          status?: 'sent' | 'failed' | 'pending';
          error_message?: string | null;
          sent_at?: string;
        };
        Update: {
          status?: 'sent' | 'failed' | 'pending';
          error_message?: string | null;
          resend_message_id?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
