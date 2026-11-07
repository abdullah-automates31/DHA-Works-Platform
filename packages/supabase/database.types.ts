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
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          created_at: string
          floor: string | null
          id: string
          is_default: boolean
          label: string | null
          lane: string
          phase: number
          plot_no: string
          resident_id: string
        }
        Insert: {
          created_at?: string
          floor?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          lane: string
          phase: number
          plot_no: string
          resident_id: string
        }
        Update: {
          created_at?: string
          floor?: string | null
          id?: string
          is_default?: boolean
          label?: string | null
          lane?: string
          phase?: number
          plot_no?: string
          resident_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "addresses_phase_fkey"
            columns: ["phase"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["phase"]
          },
          {
            foreignKeyName: "addresses_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_factor_challenges: {
        Row: {
          code_hash: string
          consumed: boolean
          created_at: string
          expires_at: string
          id: string
          session_id: string
          tries: number
          user_id: string
        }
        Insert: {
          code_hash: string
          consumed?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          session_id: string
          tries?: number
          user_id: string
        }
        Update: {
          code_hash?: string
          consumed?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          session_id?: string
          tries?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_factor_challenges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_verified_sessions: {
        Row: {
          session_id: string
          user_id: string
          verified_at: string
        }
        Insert: {
          session_id: string
          user_id: string
          verified_at?: string
        }
        Update: {
          session_id?: string
          user_id?: string
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_verified_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: number
          new_data: Json | null
          old_data: Json | null
          reason: string | null
          record_id: string | null
          table_name: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          reason?: string | null
          record_id?: string | null
          table_name?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: never
          new_data?: Json | null
          old_data?: Json | null
          reason?: string | null
          record_id?: string | null
          table_name?: string | null
        }
        Relationships: []
      }
      cancellation_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          details: string | null
          id: string
          job_id: string
          reason_code: Database["public"]["Enums"]["cancellation_reason"]
          requester_id: string
          requester_role: Database["public"]["Enums"]["user_role"]
          status: Database["public"]["Enums"]["cancellation_status"]
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          details?: string | null
          id?: string
          job_id: string
          reason_code: Database["public"]["Enums"]["cancellation_reason"]
          requester_id: string
          requester_role: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["cancellation_status"]
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          details?: string | null
          id?: string
          job_id?: string
          reason_code?: Database["public"]["Enums"]["cancellation_reason"]
          requester_id?: string
          requester_role?: Database["public"]["Enums"]["user_role"]
          status?: Database["public"]["Enums"]["cancellation_status"]
        }
        Relationships: [
          {
            foreignKeyName: "cancellation_requests_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cancellation_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_records: {
        Row: {
          agreed_amount: number
          job_id: string
          matched: boolean | null
          quote_difference: number | null
          resident_amount: number | null
          resident_confirmed_at: string | null
          worker_amount: number | null
          worker_reason: string | null
          worker_recorded_at: string | null
        }
        Insert: {
          agreed_amount: number
          job_id: string
          matched?: boolean | null
          quote_difference?: number | null
          resident_amount?: number | null
          resident_confirmed_at?: string | null
          worker_amount?: number | null
          worker_reason?: string | null
          worker_recorded_at?: string | null
        }
        Update: {
          agreed_amount?: number
          job_id?: string
          matched?: boolean | null
          quote_difference?: number | null
          resident_amount?: number | null
          resident_confirmed_at?: string | null
          worker_amount?: number | null
          worker_reason?: string | null
          worker_recorded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cash_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_records_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          active: boolean
          created_at: string
          id: number
          name: string
          slug: string
          sort: number
          subtitle: string | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: never
          name: string
          slug: string
          sort?: number
          subtitle?: string | null
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: never
          name?: string
          slug?: string
          sort?: number
          subtitle?: string | null
        }
        Relationships: []
      }
      device_tokens: {
        Row: {
          platform: string
          push_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          platform: string
          push_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          platform?: string
          push_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "device_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      helpline_calls: {
        Row: {
          callback_done_at: string | null
          called_at: string
          caller_name: string
          caller_phone: string
          caller_role: string
          id: string
          logged_by: string
          notes: string | null
          outcome: string
          reason: string
          report_id: string | null
        }
        Insert: {
          callback_done_at?: string | null
          called_at?: string
          caller_name: string
          caller_phone: string
          caller_role: string
          id?: string
          logged_by: string
          notes?: string | null
          outcome: string
          reason: string
          report_id?: string | null
        }
        Update: {
          callback_done_at?: string | null
          called_at?: string
          caller_name?: string
          caller_phone?: string
          caller_role?: string
          id?: string
          logged_by?: string
          notes?: string | null
          outcome?: string
          reason?: string
          report_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "helpline_calls_logged_by_fkey"
            columns: ["logged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "helpline_calls_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      job_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: number
          job_id: string
          payload: Json
          resident_only: boolean
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: never
          job_id: string
          payload?: Json
          resident_only?: boolean
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: never
          job_id?: string
          payload?: Json
          resident_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "job_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_events_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_interests: {
        Row: {
          created_at: string
          job_id: string
          withdrawn_at: string | null
          worker_id: string
        }
        Insert: {
          created_at?: string
          job_id: string
          withdrawn_at?: string | null
          worker_id: string
        }
        Update: {
          created_at?: string
          job_id?: string
          withdrawn_at?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_interests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_interests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_interests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_interests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_interests_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      job_photos: {
        Row: {
          id: string
          job_id: string
          sort: number
          storage_path: string
        }
        Insert: {
          id?: string
          job_id: string
          sort?: number
          storage_path: string
        }
        Update: {
          id?: string
          job_id?: string
          sort?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_photos_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_private: {
        Row: {
          floor: string | null
          job_id: string
          plot_no: string
          resident_phone: string
        }
        Insert: {
          floor?: string | null
          job_id: string
          plot_no: string
          resident_phone: string
        }
        Update: {
          floor?: string | null
          job_id?: string
          plot_no?: string
          resident_phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_private_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_private_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_private_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_private_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_views: {
        Row: {
          job_id: string
          viewed_at: string
          worker_id: string
        }
        Insert: {
          job_id: string
          viewed_at?: string
          worker_id: string
        }
        Update: {
          job_id?: string
          viewed_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_views_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_views_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_views_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_views_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_views_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          accepted_quote_id: string | null
          accepted_worker_id: string | null
          address_id: string | null
          cancel_reason: string | null
          cancelled_by: string | null
          category_id: number
          code: string
          completed_at: string | null
          created_at: string
          description: string
          id: string
          lane: string
          material_bill_path: string | null
          phase: number
          posted_at: string | null
          preferred_date: string | null
          resident_id: string
          scheduled_end: string | null
          scheduled_start: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          stuck_reason: string | null
          stuck_since: string | null
          title: string
          under_review_reason: string | null
          updated_at: string
          urgency: Database["public"]["Enums"]["job_urgency"]
          voice_note_path: string | null
          window_from: string | null
          window_to: string | null
        }
        Insert: {
          accepted_quote_id?: string | null
          accepted_worker_id?: string | null
          address_id?: string | null
          cancel_reason?: string | null
          cancelled_by?: string | null
          category_id: number
          code?: string
          completed_at?: string | null
          created_at?: string
          description: string
          id?: string
          lane: string
          material_bill_path?: string | null
          phase: number
          posted_at?: string | null
          preferred_date?: string | null
          resident_id: string
          scheduled_end?: string | null
          scheduled_start?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          stuck_reason?: string | null
          stuck_since?: string | null
          title: string
          under_review_reason?: string | null
          updated_at?: string
          urgency?: Database["public"]["Enums"]["job_urgency"]
          voice_note_path?: string | null
          window_from?: string | null
          window_to?: string | null
        }
        Update: {
          accepted_quote_id?: string | null
          accepted_worker_id?: string | null
          address_id?: string | null
          cancel_reason?: string | null
          cancelled_by?: string | null
          category_id?: number
          code?: string
          completed_at?: string | null
          created_at?: string
          description?: string
          id?: string
          lane?: string
          material_bill_path?: string | null
          phase?: number
          posted_at?: string | null
          preferred_date?: string | null
          resident_id?: string
          scheduled_end?: string | null
          scheduled_start?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          stuck_reason?: string | null
          stuck_since?: string | null
          title?: string
          under_review_reason?: string | null
          updated_at?: string
          urgency?: Database["public"]["Enums"]["job_urgency"]
          voice_note_path?: string | null
          window_from?: string | null
          window_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_accepted_quote_fk"
            columns: ["accepted_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_accepted_quote_fk"
            columns: ["accepted_quote_id"]
            isOneToOne: false
            referencedRelation: "resident_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_accepted_quote_fk"
            columns: ["accepted_quote_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["my_quote_id"]
          },
          {
            foreignKeyName: "jobs_accepted_worker_id_fkey"
            columns: ["accepted_worker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories_with_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_phase_fkey"
            columns: ["phase"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["phase"]
          },
          {
            foreignKeyName: "jobs_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          job_id: string | null
          payload: Json
          push_sent_at: string | null
          read_at: string | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id?: string | null
          payload?: Json
          push_sent_at?: string | null
          read_at?: string | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string | null
          payload?: Json
          push_sent_at?: string | null
          read_at?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          account_status: Database["public"]["Enums"]["account_status"]
          avatar_path: string | null
          cnic: string | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          full_name: string | null
          gender: Database["public"]["Enums"]["gender"] | null
          id: string
          locale: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          suspended_at: string | null
          suspended_until: string | null
          suspension_reason: string | null
          updated_at: string
          verification_reason: string | null
          verification_status: Database["public"]["Enums"]["verification_status"]
          verification_updated_at: string | null
        }
        Insert: {
          account_status?: Database["public"]["Enums"]["account_status"]
          avatar_path?: string | null
          cnic?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          id: string
          locale?: string
          phone?: string | null
          role: Database["public"]["Enums"]["user_role"]
          suspended_at?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          updated_at?: string
          verification_reason?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verification_updated_at?: string | null
        }
        Update: {
          account_status?: Database["public"]["Enums"]["account_status"]
          avatar_path?: string | null
          cnic?: string | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          full_name?: string | null
          gender?: Database["public"]["Enums"]["gender"] | null
          id?: string
          locale?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          suspended_at?: string | null
          suspended_until?: string | null
          suspension_reason?: string | null
          updated_at?: string
          verification_reason?: string | null
          verification_status?: Database["public"]["Enums"]["verification_status"]
          verification_updated_at?: string | null
        }
        Relationships: []
      }
      quotes: {
        Row: {
          created_at: string
          decided_at: string | null
          id: string
          job_id: string
          labour: number
          material_bill_path: string | null
          materials: number
          materials_note: string | null
          note: string | null
          other_amount: number
          other_note: string | null
          reject_reason: string | null
          status: Database["public"]["Enums"]["quote_status"]
          total: number | null
          visit_end: string | null
          visit_start: string | null
          worker_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          id?: string
          job_id: string
          labour: number
          material_bill_path?: string | null
          materials?: number
          materials_note?: string | null
          note?: string | null
          other_amount?: number
          other_note?: string | null
          reject_reason?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          total?: number | null
          visit_end?: string | null
          visit_start?: string | null
          worker_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          id?: string
          job_id?: string
          labour?: number
          material_bill_path?: string | null
          materials?: number
          materials_note?: string | null
          note?: string | null
          other_amount?: number
          other_note?: string | null
          reject_reason?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          total?: number | null
          visit_end?: string | null
          visit_start?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      report_calls: {
        Row: {
          called_at: string
          called_by: string
          called_id: string
          id: string
          outcome: string | null
          report_id: string
        }
        Insert: {
          called_at?: string
          called_by: string
          called_id: string
          id?: string
          outcome?: string | null
          report_id: string
        }
        Update: {
          called_at?: string
          called_by?: string
          called_id?: string
          id?: string
          outcome?: string | null
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_calls_called_by_fkey"
            columns: ["called_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_calls_called_id_fkey"
            columns: ["called_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_calls_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_notes: {
        Row: {
          author_id: string
          created_at: string
          id: string
          note: string
          report_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          note: string
          report_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          note?: string
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_notes_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      report_photos: {
        Row: {
          id: string
          report_id: string
          storage_path: string
        }
        Insert: {
          id?: string
          report_id: string
          storage_path: string
        }
        Update: {
          id?: string
          report_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_photos_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          action: Database["public"]["Enums"]["report_action"] | null
          action_reason: string | null
          against_id: string
          assigned_to: string | null
          code: string
          created_at: string
          id: string
          job_id: string
          kind: Database["public"]["Enums"]["report_kind"]
          reason_text: string | null
          reporter_id: string
          reporter_role: Database["public"]["Enums"]["user_role"]
          resolved_at: string | null
          status: Database["public"]["Enums"]["report_status"]
          system_generated: boolean
        }
        Insert: {
          action?: Database["public"]["Enums"]["report_action"] | null
          action_reason?: string | null
          against_id: string
          assigned_to?: string | null
          code?: string
          created_at?: string
          id?: string
          job_id: string
          kind: Database["public"]["Enums"]["report_kind"]
          reason_text?: string | null
          reporter_id: string
          reporter_role: Database["public"]["Enums"]["user_role"]
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          system_generated?: boolean
        }
        Update: {
          action?: Database["public"]["Enums"]["report_action"] | null
          action_reason?: string | null
          against_id?: string
          assigned_to?: string | null
          code?: string
          created_at?: string
          id?: string
          job_id?: string
          kind?: Database["public"]["Enums"]["report_kind"]
          reason_text?: string | null
          reporter_id?: string
          reporter_role?: Database["public"]["Enums"]["user_role"]
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["report_status"]
          system_generated?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "reports_against_id_fkey"
            columns: ["against_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          behaviour: number
          comment: string | null
          completeness: number
          created_at: string
          hidden_at: string | null
          hidden_by: string | null
          hidden_reason: string | null
          hire_again: boolean
          id: string
          job_id: string
          quality: number
          resident_id: string
          worker_id: string
        }
        Insert: {
          behaviour: number
          comment?: string | null
          completeness: number
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          hire_again: boolean
          id?: string
          job_id: string
          quality: number
          resident_id: string
          worker_id: string
        }
        Update: {
          behaviour?: number
          comment?: string | null
          completeness?: number
          created_at?: string
          hidden_at?: string | null
          hidden_by?: string | null
          hidden_reason?: string | null
          hire_again?: boolean
          id?: string
          job_id?: string
          quality?: number
          resident_id?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_hidden_by_fkey"
            columns: ["hidden_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_resident_id_fkey"
            columns: ["resident_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      service_areas: {
        Row: {
          active: boolean
          phase: number
        }
        Insert: {
          active?: boolean
          phase: number
        }
        Update: {
          active?: boolean
          phase?: number
        }
        Relationships: []
      }
      staff_invites: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          status: string
          token_hash: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          status?: string
          token_hash?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          status?: string
          token_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "staff_invites_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_notes: {
        Row: {
          author_id: string
          created_at: string
          id: string
          note: string
          profile_id: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          note: string
          profile_id: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          note?: string
          profile_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_notes_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_decisions: {
        Row: {
          checklist: Json
          decided_at: string
          decided_by: string
          decision: Database["public"]["Enums"]["verification_decision"]
          id: string
          profile_id: string
          reason: string | null
        }
        Insert: {
          checklist?: Json
          decided_at?: string
          decided_by: string
          decision: Database["public"]["Enums"]["verification_decision"]
          id?: string
          profile_id: string
          reason?: string | null
        }
        Update: {
          checklist?: Json
          decided_at?: string
          decided_by?: string
          decision?: Database["public"]["Enums"]["verification_decision"]
          id?: string
          profile_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "verification_decisions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "verification_decisions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      verification_documents: {
        Row: {
          doc_type: Database["public"]["Enums"]["document_type"]
          id: string
          profile_id: string
          storage_path: string
          uploaded_at: string
        }
        Insert: {
          doc_type: Database["public"]["Enums"]["document_type"]
          id?: string
          profile_id: string
          storage_path: string
          uploaded_at?: string
        }
        Update: {
          doc_type?: Database["public"]["Enums"]["document_type"]
          id?: string
          profile_id?: string
          storage_path?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "verification_documents_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_areas: {
        Row: {
          phase: number
          worker_id: string
        }
        Insert: {
          phase: number
          worker_id: string
        }
        Update: {
          phase?: number
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_areas_phase_fkey"
            columns: ["phase"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["phase"]
          },
          {
            foreignKeyName: "worker_areas_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_categories: {
        Row: {
          category_id: number
          worker_id: string
        }
        Insert: {
          category_id: number
          worker_id: string
        }
        Update: {
          category_id?: number
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories_with_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_categories_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_details: {
        Row: {
          about: string | null
          available_today: boolean
          experience_years: number | null
          jobs_done: number
          profile_id: string
          rating_avg: number
          rating_count: number
          visit_fee: number
          voice_intro_path: string | null
        }
        Insert: {
          about?: string | null
          available_today?: boolean
          experience_years?: number | null
          jobs_done?: number
          profile_id: string
          rating_avg?: number
          rating_count?: number
          visit_fee?: number
          voice_intro_path?: string | null
        }
        Update: {
          about?: string | null
          available_today?: boolean
          experience_years?: number | null
          jobs_done?: number
          profile_id?: string
          rating_avg?: number
          rating_count?: number
          visit_fee?: number
          voice_intro_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_details_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_references: {
        Row: {
          address: string | null
          id: string
          name: string
          phone: string
          worker_id: string
        }
        Insert: {
          address?: string | null
          id?: string
          name: string
          phone: string
          worker_id: string
        }
        Update: {
          address?: string | null
          id?: string
          name?: string
          phone?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_references_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      categories_with_counts: {
        Row: {
          id: number | null
          name: string | null
          pros_nearby: number | null
          slug: string | null
          sort: number | null
          subtitle: string | null
        }
        Relationships: []
      }
      resident_jobs: {
        Row: {
          accepted_quote_id: string | null
          accepted_worker_id: string | null
          address_id: string | null
          cancellation_pending: boolean | null
          category_id: number | null
          category_name: string | null
          code: string | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          expires_at: string | null
          id: string | null
          interest_count: number | null
          lane: string | null
          lowest_quote: number | null
          material_bill_path: string | null
          phase: number | null
          posted_at: string | null
          preferred_date: string | null
          quote_count: number | null
          scheduled_end: string | null
          scheduled_start: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"] | null
          stuck_since: string | null
          thumb_path: string | null
          title: string | null
          under_review_reason: string | null
          updated_at: string | null
          urgency: Database["public"]["Enums"]["job_urgency"] | null
          viewed_count: number | null
          voice_note_path: string | null
          window_from: string | null
          window_to: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_accepted_quote_fk"
            columns: ["accepted_quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_accepted_quote_fk"
            columns: ["accepted_quote_id"]
            isOneToOne: false
            referencedRelation: "resident_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_accepted_quote_fk"
            columns: ["accepted_quote_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["my_quote_id"]
          },
          {
            foreignKeyName: "jobs_accepted_worker_id_fkey"
            columns: ["accepted_worker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_address_id_fkey"
            columns: ["address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories_with_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_phase_fkey"
            columns: ["phase"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["phase"]
          },
        ]
      }
      resident_quotes: {
        Row: {
          avatar_path: string | null
          created_at: string | null
          experience_years: number | null
          id: string | null
          is_top_rated: boolean | null
          job_id: string | null
          jobs_done: number | null
          labour: number | null
          material_bill_path: string | null
          materials: number | null
          materials_note: string | null
          note: string | null
          other_amount: number | null
          other_note: string | null
          rating_avg: number | null
          rating_count: number | null
          status: Database["public"]["Enums"]["quote_status"] | null
          total: number | null
          visit_end: string | null
          visit_fee: number | null
          visit_start: string | null
          voice_intro_path: string | null
          worker_about: string | null
          worker_id: string | null
          worker_name: string | null
          worker_phone: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "resident_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_feed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "worker_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_feed: {
        Row: {
          category_id: number | null
          category_name: string | null
          code: string | null
          description: string | null
          expires_at: string | null
          id: string | null
          interest_count: number | null
          lane: string | null
          phase: number | null
          photo_count: number | null
          posted_at: string | null
          preferred_date: string | null
          quote_count: number | null
          status: Database["public"]["Enums"]["job_status"] | null
          thumb_path: string | null
          thumb_paths: string[] | null
          title: string | null
          urgency: Database["public"]["Enums"]["job_urgency"] | null
          viewed_count: number | null
          voice_note_path: string | null
          window_from: string | null
          window_to: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories_with_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_phase_fkey"
            columns: ["phase"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["phase"]
          },
        ]
      }
      worker_jobs: {
        Row: {
          cancellation_pending: boolean | null
          cash_recorded: boolean | null
          category_id: number | null
          category_name: string | null
          code: string | null
          completed_at: string | null
          description: string | null
          floor: string | null
          id: string | null
          is_mine: boolean | null
          lane: string | null
          my_quote_id: string | null
          my_quote_status: Database["public"]["Enums"]["quote_status"] | null
          my_quote_total: number | null
          phase: number | null
          plot_no: string | null
          posted_at: string | null
          preferred_date: string | null
          resident_name: string | null
          resident_phone: string | null
          scheduled_end: string | null
          scheduled_start: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"] | null
          stuck_since: string | null
          title: string | null
          under_review_reason: string | null
          urgency: Database["public"]["Enums"]["job_urgency"] | null
          voice_note_path: string | null
          window_from: string | null
          window_to: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jobs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories_with_counts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_phase_fkey"
            columns: ["phase"]
            isOneToOne: false
            referencedRelation: "service_areas"
            referencedColumns: ["phase"]
          },
        ]
      }
    }
    Functions: {
      accept_job: {
        Args: {
          p_job_id: string
          p_labour: number
          p_materials?: number
          p_materials_note?: string
          p_note?: string
        }
        Returns: string
      }
      accept_quote: { Args: { p_quote_id: string }; Returns: undefined }
      accept_staff_invite: {
        Args: { p_email: string; p_full_name: string; p_token: string }
        Returns: undefined
      }
      add_verification_document: {
        Args: {
          p_path: string
          p_type: Database["public"]["Enums"]["document_type"]
        }
        Returns: undefined
      }
      admin_add_category: {
        Args: { p_name: string; p_subtitle: string }
        Returns: number
      }
      admin_add_staff_note: {
        Args: { p_note: string; p_profile: string }
        Returns: undefined
      }
      admin_cancel_job: {
        Args: { p_job: string; p_reason: string }
        Returns: undefined
      }
      admin_cancellations_list: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: Json
      }
      admin_dashboard: { Args: never; Returns: Json }
      admin_decide_cancellation: {
        Args: { p_approve: boolean; p_note: string; p_request: string }
        Returns: undefined
      }
      admin_decide_verification: {
        Args: {
          p_checklist: Json
          p_decision: Database["public"]["Enums"]["verification_decision"]
          p_profile: string
          p_reason: string
        }
        Returns: undefined
      }
      admin_helpline_callback_done: {
        Args: { p_call: string }
        Returns: undefined
      }
      admin_helpline_list: {
        Args: {
          p_callback_only?: boolean
          p_limit?: number
          p_offset?: number
          p_range?: string
          p_search?: string
        }
        Returns: Json
      }
      admin_helpline_summary: { Args: never; Returns: Json }
      admin_issue_challenge: {
        Args: { p_session: string; p_user: string }
        Returns: string
      }
      admin_job_detail: { Args: { p_job: string }; Returns: Json }
      admin_job_replace_worker: {
        Args: { p_job: string; p_reason: string }
        Returns: undefined
      }
      admin_job_resume: {
        Args: { p_job: string; p_note: string }
        Returns: undefined
      }
      admin_jobs_counts: { Args: never; Returns: Json }
      admin_jobs_list: {
        Args: {
          p_category?: number
          p_limit?: number
          p_offset?: number
          p_phase?: number
          p_search?: string
          p_status?: Database["public"]["Enums"]["job_status"]
          p_today?: boolean
        }
        Returns: Json
      }
      admin_log_call: {
        Args: {
          p_name: string
          p_notes: string
          p_outcome: string
          p_phone: string
          p_reason: string
          p_report_code: string
          p_role: string
        }
        Returns: string
      }
      admin_remove_staff: {
        Args: { p_profile: string; p_reason: string }
        Returns: undefined
      }
      admin_report_add_note: {
        Args: { p_note: string; p_report: string }
        Returns: undefined
      }
      admin_report_decide: {
        Args: { p_choice: string; p_reason: string; p_report: string }
        Returns: undefined
      }
      admin_report_detail: { Args: { p_report: string }; Returns: Json }
      admin_report_log_call: {
        Args: { p_called: string; p_outcome: string; p_report: string }
        Returns: undefined
      }
      admin_reports_counts: { Args: never; Returns: Json }
      admin_reports_list: {
        Args: {
          p_kind?: Database["public"]["Enums"]["report_kind"]
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_tab?: string
        }
        Returns: Json
      }
      admin_reviews_list: {
        Args: {
          p_category?: number
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_stars?: string
          p_worker?: string
        }
        Returns: Json
      }
      admin_save_settings: {
        Args: {
          p_helpline_enabled: boolean
          p_helpline_number: string
          p_report_window_days: number
          p_review_window_days: number
        }
        Returns: undefined
      }
      admin_send_message: {
        Args: { p_profile: string; p_text: string }
        Returns: undefined
      }
      admin_session_status: { Args: never; Returns: string }
      admin_set_account_status: {
        Args: { p_profile: string; p_reason: string; p_suspend: boolean }
        Returns: undefined
      }
      admin_set_phase_active: {
        Args: { p_active: boolean; p_phase: number }
        Returns: undefined
      }
      admin_set_review_hidden: {
        Args: { p_hidden: boolean; p_reason: string; p_review: string }
        Returns: undefined
      }
      admin_settings_get: { Args: never; Returns: Json }
      admin_staff_list: { Args: never; Returns: Json }
      admin_update_category: {
        Args: {
          p_active: boolean
          p_id: number
          p_name: string
          p_subtitle: string
        }
        Returns: undefined
      }
      admin_user_detail: { Args: { p_profile: string }; Returns: Json }
      admin_users_counts: { Args: never; Returns: Json }
      admin_users_list: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_phase?: number
          p_role: Database["public"]["Enums"]["user_role"]
          p_search?: string
          p_state?: string
        }
        Returns: Json
      }
      admin_verification_counts: {
        Args: { p_role: Database["public"]["Enums"]["user_role"] }
        Returns: Json
      }
      admin_verification_detail: { Args: { p_profile: string }; Returns: Json }
      admin_verification_queue: {
        Args: {
          p_filter?: number
          p_limit?: number
          p_offset?: number
          p_role: Database["public"]["Enums"]["user_role"]
          p_search?: string
          p_status: Database["public"]["Enums"]["verification_status"]
        }
        Returns: Json
      }
      admin_verify_code: { Args: { p_code: string }; Returns: string }
      can_upload_media: { Args: { p_bucket: string }; Returns: boolean }
      can_view_job: { Args: { p_job: string }; Returns: boolean }
      cancel_job: {
        Args: { p_job_id: string; p_reason?: string }
        Returns: undefined
      }
      clear_my_notifications: { Args: never; Returns: undefined }
      complete_job: {
        Args: { p_bill_path?: string; p_job_id: string }
        Returns: undefined
      }
      confirm_cash_resident: {
        Args: { p_amount: number; p_job_id: string }
        Returns: undefined
      }
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      delete_draft: { Args: { p_job_id: string }; Returns: undefined }
      express_interest: { Args: { p_job_id: string }; Returns: undefined }
      file_report: {
        Args: {
          p_job_id: string
          p_kind: Database["public"]["Enums"]["report_kind"]
          p_photo_paths?: string[]
          p_text?: string
        }
        Returns: string
      }
      get_my_earnings: {
        Args: { p_from?: string; p_to?: string }
        Returns: Json
      }
      get_setting: { Args: { p_key: string }; Returns: Json }
      invite_staff: { Args: { p_email: string }; Returns: string }
      is_accepted_worker: { Args: { p_job: string }; Returns: boolean }
      is_active_approved: {
        Args: { p_role: Database["public"]["Enums"]["user_role"] }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_filed_bill: { Args: { p_name: string }; Returns: boolean }
      is_job_owner: { Args: { p_job: string }; Returns: boolean }
      mark_notifications_read: {
        Args: { p_ids?: string[] }
        Returns: undefined
      }
      post_job: { Args: { p_job_id: string }; Returns: undefined }
      push_webhook_secret_matches: {
        Args: { p_secret: string }
        Returns: boolean
      }
      record_cash_worker: {
        Args: { p_amount: number; p_job_id: string; p_reason?: string }
        Returns: undefined
      }
      record_job_view: { Args: { p_job_id: string }; Returns: undefined }
      register_device_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      register_profile: {
        Args: {
          p_cnic?: string
          p_date_of_birth?: string
          p_full_name: string
          p_gender?: Database["public"]["Enums"]["gender"]
          p_phone: string
          p_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: undefined
      }
      reject_quote: {
        Args: { p_quote_id: string; p_reason?: string }
        Returns: undefined
      }
      replace_worker: {
        Args: { p_job_id: string; p_reason?: string }
        Returns: undefined
      }
      request_cancellation: {
        Args: {
          p_details?: string
          p_job_id: string
          p_reason_code: Database["public"]["Enums"]["cancellation_reason"]
        }
        Returns: string
      }
      resident_may_see_worker_media: {
        Args: { p_folder: string }
        Returns: boolean
      }
      revoke_staff_invite: { Args: { p_invite: string }; Returns: undefined }
      save_job_draft: {
        Args: {
          p_address_id?: string
          p_category_id?: number
          p_description?: string
          p_job_id?: string
          p_photo_paths?: string[]
          p_preferred_date?: string
          p_title?: string
          p_urgency?: Database["public"]["Enums"]["job_urgency"]
          p_voice_note_path?: string
          p_window_from?: string
          p_window_to?: string
        }
        Returns: string
      }
      set_available_today: { Args: { p_value: boolean }; Returns: undefined }
      set_my_areas: { Args: { p_phases: number[] }; Returns: undefined }
      set_my_categories: {
        Args: { p_category_ids: number[] }
        Returns: undefined
      }
      set_my_references: { Args: { p_refs: Json }; Returns: undefined }
      start_job: { Args: { p_job_id: string }; Returns: undefined }
      submit_for_review: { Args: never; Returns: undefined }
      submit_quote: {
        Args: {
          p_job_id: string
          p_labour: number
          p_material_bill_path?: string
          p_materials?: number
          p_materials_note?: string
          p_note?: string
          p_other_amount?: number
          p_other_note?: string
          p_visit_end?: string
          p_visit_start?: string
        }
        Returns: string
      }
      submit_review: {
        Args: {
          p_behaviour: number
          p_comment?: string
          p_completeness: number
          p_hire_again: boolean
          p_job_id: string
          p_quality: number
        }
        Returns: undefined
      }
      unregister_device_token: { Args: { p_token: string }; Returns: undefined }
      update_job: {
        Args: {
          p_description: string
          p_job_id: string
          p_photo_paths?: string[]
          p_preferred_date?: string
          p_title: string
          p_urgency: Database["public"]["Enums"]["job_urgency"]
          p_voice_note_path?: string
          p_window_from?: string
          p_window_to?: string
        }
        Returns: undefined
      }
      update_my_profile: {
        Args: {
          p_avatar_path?: string
          p_cnic?: string
          p_date_of_birth?: string
          p_full_name?: string
          p_gender?: Database["public"]["Enums"]["gender"]
          p_locale?: string
          p_phone?: string
        }
        Returns: undefined
      }
      update_worker_details: {
        Args: {
          p_about?: string
          p_experience_years?: number
          p_visit_fee?: number
          p_voice_intro_path?: string
        }
        Returns: undefined
      }
      upsert_address: {
        Args: {
          p_floor?: string
          p_id?: string
          p_is_default?: boolean
          p_label?: string
          p_lane?: string
          p_phase?: number
          p_plot_no?: string
        }
        Returns: string
      }
      withdraw_cancellation_request: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      withdraw_interest: { Args: { p_job_id: string }; Returns: undefined }
      withdraw_quote: { Args: { p_quote_id: string }; Returns: undefined }
      worker_has_stake: { Args: { p_job: string }; Returns: boolean }
      worker_is_rejected_on: { Args: { p_job: string }; Returns: boolean }
      worker_matches_job: {
        Args: { p_category: number; p_phase: number }
        Returns: boolean
      }
      worker_may_see_job: { Args: { p_job: string }; Returns: boolean }
      worker_public_profile: { Args: { p_worker_id: string }; Returns: Json }
    }
    Enums: {
      account_status: "active" | "suspended"
      cancellation_reason:
        | "schedule_conflict"
        | "no_longer_needed"
        | "price_dispute"
        | "safety_concern"
        | "worker_unavailable"
        | "other"
      cancellation_status: "pending" | "approved" | "declined" | "withdrawn"
      document_type:
        | "cnic_front"
        | "cnic_back"
        | "utility_bill"
        | "police_cert"
        | "profile_photo"
      gender: "male" | "female" | "other"
      job_status:
        | "draft"
        | "open"
        | "interested"
        | "quoted"
        | "accepted"
        | "scheduled"
        | "in_progress"
        | "completed"
        | "cash_collected"
        | "reviewed"
        | "disputed"
        | "cancelled"
        | "expired"
      job_urgency: "asap" | "scheduled"
      quote_status:
        | "sent"
        | "accepted"
        | "rejected"
        | "not_selected"
        | "withdrawn"
        | "expired"
      report_action: "no_action" | "warning" | "suspend"
      report_kind:
        | "unsafe"
        | "cash_price"
        | "no_show"
        | "poor_work"
        | "rude_damage"
        | "other"
      report_status: "new" | "in_review" | "resolved"
      user_role: "resident" | "worker" | "admin"
      verification_decision:
        | "approve"
        | "ask_for_changes"
        | "visit_hq"
        | "reject"
      verification_status:
        | "incomplete"
        | "pending"
        | "approved"
        | "needs_changes"
        | "visit_hq"
        | "rejected"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      account_status: ["active", "suspended"],
      cancellation_reason: [
        "schedule_conflict",
        "no_longer_needed",
        "price_dispute",
        "safety_concern",
        "worker_unavailable",
        "other",
      ],
      cancellation_status: ["pending", "approved", "declined", "withdrawn"],
      document_type: [
        "cnic_front",
        "cnic_back",
        "utility_bill",
        "police_cert",
        "profile_photo",
      ],
      gender: ["male", "female", "other"],
      job_status: [
        "draft",
        "open",
        "interested",
        "quoted",
        "accepted",
        "scheduled",
        "in_progress",
        "completed",
        "cash_collected",
        "reviewed",
        "disputed",
        "cancelled",
        "expired",
      ],
      job_urgency: ["asap", "scheduled"],
      quote_status: [
        "sent",
        "accepted",
        "rejected",
        "not_selected",
        "withdrawn",
        "expired",
      ],
      report_action: ["no_action", "warning", "suspend"],
      report_kind: [
        "unsafe",
        "cash_price",
        "no_show",
        "poor_work",
        "rude_damage",
        "other",
      ],
      report_status: ["new", "in_review", "resolved"],
      user_role: ["resident", "worker", "admin"],
      verification_decision: [
        "approve",
        "ask_for_changes",
        "visit_hq",
        "reject",
      ],
      verification_status: [
        "incomplete",
        "pending",
        "approved",
        "needs_changes",
        "visit_hq",
        "rejected",
      ],
    },
  },
} as const
