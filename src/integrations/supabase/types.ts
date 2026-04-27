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
      backend_slots: {
        Row: {
          addon_code: string
          amount_minor: number
          consumed_by_backend_id: string | null
          created_at: string
          currency_code: string
          environment: string
          expires_at: string
          id: string
          paystack_reference: string
          project_id: string
          purchased_at: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          addon_code: string
          amount_minor: number
          consumed_by_backend_id?: string | null
          created_at?: string
          currency_code: string
          environment?: string
          expires_at: string
          id?: string
          paystack_reference: string
          project_id: string
          purchased_at?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          addon_code?: string
          amount_minor?: number
          consumed_by_backend_id?: string | null
          created_at?: string
          currency_code?: string
          environment?: string
          expires_at?: string
          id?: string
          paystack_reference?: string
          project_id?: string
          purchased_at?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      billing_addons: {
        Row: {
          code: string
          created_at: string
          description: string | null
          duration_days: number
          is_active: boolean
          name: string
          price_cents: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          description?: string | null
          duration_days: number
          is_active?: boolean
          name: string
          price_cents: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          description?: string | null
          duration_days?: number
          is_active?: boolean
          name?: string
          price_cents?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      billing_currencies: {
        Row: {
          code: string
          created_at: string
          is_active: boolean
          name: string
          paystack_supported: boolean
          sort_order: number
          symbol: string
          updated_at: string
          usd_rate: number
        }
        Insert: {
          code: string
          created_at?: string
          is_active?: boolean
          name: string
          paystack_supported?: boolean
          sort_order?: number
          symbol: string
          updated_at?: string
          usd_rate?: number
        }
        Update: {
          code?: string
          created_at?: string
          is_active?: boolean
          name?: string
          paystack_supported?: boolean
          sort_order?: number
          symbol?: string
          updated_at?: string
          usd_rate?: number
        }
        Relationships: []
      }
      billing_plans: {
        Row: {
          code: string
          created_at: string
          daily_free_credits: number
          features: Json
          is_active: boolean
          monthly_credits: number
          monthly_free_cap: number | null
          name: string
          price_cents: number
          sort_order: number
          stripe_price_id: string | null
          tier: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          daily_free_credits?: number
          features?: Json
          is_active?: boolean
          monthly_credits?: number
          monthly_free_cap?: number | null
          name: string
          price_cents?: number
          sort_order?: number
          stripe_price_id?: string | null
          tier: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          daily_free_credits?: number
          features?: Json
          is_active?: boolean
          monthly_credits?: number
          monthly_free_cap?: number | null
          name?: string
          price_cents?: number
          sort_order?: number
          stripe_price_id?: string | null
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      billing_price_overrides: {
        Row: {
          amount_minor: number
          currency_code: string
          item_code: string
          item_kind: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          currency_code: string
          item_code: string
          item_kind: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          currency_code?: string
          item_code?: string
          item_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_price_overrides_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "billing_currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          balance_after: number
          created_at: string
          delta: number
          id: string
          metadata: Json
          project_id: string | null
          reason: string
          user_id: string
        }
        Insert: {
          balance_after: number
          created_at?: string
          delta: number
          id?: string
          metadata?: Json
          project_id?: string | null
          reason: string
          user_id: string
        }
        Update: {
          balance_after?: number
          created_at?: string
          delta?: number
          id?: string
          metadata?: Json
          project_id?: string | null
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_packs: {
        Row: {
          code: string
          created_at: string
          credits: number
          is_active: boolean
          name: string
          price_cents: number
          sort_order: number
          stripe_price_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          credits: number
          is_active?: boolean
          name: string
          price_cents: number
          sort_order?: number
          stripe_price_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          credits?: number
          is_active?: boolean
          name?: string
          price_cents?: number
          sort_order?: number
          stripe_price_id?: string | null
        }
        Relationships: []
      }
      domain_slots: {
        Row: {
          addon_code: string
          amount_minor: number
          consumed_by_domain_id: string | null
          created_at: string
          currency_code: string
          environment: string
          expires_at: string
          id: string
          paystack_reference: string
          project_id: string
          purchased_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          addon_code: string
          amount_minor: number
          consumed_by_domain_id?: string | null
          created_at?: string
          currency_code: string
          environment?: string
          expires_at: string
          id?: string
          paystack_reference: string
          project_id: string
          purchased_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          addon_code?: string
          amount_minor?: number
          consumed_by_domain_id?: string | null
          created_at?: string
          currency_code?: string
          environment?: string
          expires_at?: string
          id?: string
          paystack_reference?: string
          project_id?: string
          purchased_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "domain_slots_addon_code_fkey"
            columns: ["addon_code"]
            isOneToOne: false
            referencedRelation: "billing_addons"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "domain_slots_consumed_by_domain_id_fkey"
            columns: ["consumed_by_domain_id"]
            isOneToOne: false
            referencedRelation: "project_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "domain_slots_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "billing_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "domain_slots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      labs_flags: {
        Row: {
          created_at: string
          flags: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          flags?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          flags?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          created_at: string
          id: string
          project_id: string
          role: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          project_id: string
          role: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          project_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      paystack_events: {
        Row: {
          id: string
          payload: Json | null
          processed_at: string
          type: string
        }
        Insert: {
          id: string
          payload?: Json | null
          processed_at?: string
          type: string
        }
        Update: {
          id?: string
          payload?: Json | null
          processed_at?: string
          type?: string
        }
        Relationships: []
      }
      paystack_transactions: {
        Row: {
          amount_minor: number
          channel: string | null
          created_at: string
          currency_code: string
          environment: string
          id: string
          item_code: string
          paid_at: string | null
          paystack_reference: string | null
          project_id: string | null
          purpose: string
          reference: string
          status: string
          updated_at: string
          usd_amount_cents: number
          user_id: string
        }
        Insert: {
          amount_minor: number
          channel?: string | null
          created_at?: string
          currency_code: string
          environment?: string
          id?: string
          item_code: string
          paid_at?: string | null
          paystack_reference?: string | null
          project_id?: string | null
          purpose: string
          reference: string
          status?: string
          updated_at?: string
          usd_amount_cents: number
          user_id: string
        }
        Update: {
          amount_minor?: number
          channel?: string | null
          created_at?: string
          currency_code?: string
          environment?: string
          id?: string
          item_code?: string
          paid_at?: string | null
          paystack_reference?: string | null
          project_id?: string | null
          purpose?: string
          reference?: string
          status?: string
          updated_at?: string
          usd_amount_cents?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paystack_transactions_currency_code_fkey"
            columns: ["currency_code"]
            isOneToOne: false
            referencedRelation: "billing_currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "paystack_transactions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      project_backends: {
        Row: {
          anon_key: string
          created_at: string
          error_message: string | null
          health_checked_at: string | null
          id: string
          paused_at: string | null
          project_id: string
          provider: string
          provisioning_started_at: string | null
          service_role_key: string | null
          status: string
          supabase_project_ref: string | null
          supabase_url: string
        }
        Insert: {
          anon_key: string
          created_at?: string
          error_message?: string | null
          health_checked_at?: string | null
          id?: string
          paused_at?: string | null
          project_id: string
          provider?: string
          provisioning_started_at?: string | null
          service_role_key?: string | null
          status?: string
          supabase_project_ref?: string | null
          supabase_url: string
        }
        Update: {
          anon_key?: string
          created_at?: string
          error_message?: string | null
          health_checked_at?: string | null
          id?: string
          paused_at?: string | null
          project_id?: string
          provider?: string
          provisioning_started_at?: string | null
          service_role_key?: string | null
          status?: string
          supabase_project_ref?: string | null
          supabase_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_backends_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_builds: {
        Row: {
          created_at: string
          dist_path: string | null
          error_message: string | null
          id: string
          project_id: string
          ready_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          dist_path?: string | null
          error_message?: string | null
          id?: string
          project_id: string
          ready_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          dist_path?: string | null
          error_message?: string | null
          id?: string
          project_id?: string
          ready_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_builds_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_domains: {
        Row: {
          created_at: string
          error_message: string | null
          hostname: string
          id: string
          is_primary: boolean
          last_checked_at: string | null
          project_id: string
          provider_hostname_id: string | null
          ssl_status: string | null
          status: string
          updated_at: string
          verification_txt_name: string
          verification_txt_value: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          hostname: string
          id?: string
          is_primary?: boolean
          last_checked_at?: string | null
          project_id: string
          provider_hostname_id?: string | null
          ssl_status?: string | null
          status?: string
          updated_at?: string
          verification_txt_name: string
          verification_txt_value: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          hostname?: string
          id?: string
          is_primary?: boolean
          last_checked_at?: string | null
          project_id?: string
          provider_hostname_id?: string | null
          ssl_status?: string | null
          status?: string
          updated_at?: string
          verification_txt_name?: string
          verification_txt_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_domains_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_files: {
        Row: {
          content: string
          id: string
          path: string
          project_id: string
          updated_at: string
        }
        Insert: {
          content?: string
          id?: string
          path: string
          project_id: string
          updated_at?: string
        }
        Update: {
          content?: string
          id?: string
          path?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_integration_secrets: {
        Row: {
          ciphertext: string
          created_at: string
          field_id: string
          id: string
          project_integration_id: string
          updated_at: string
        }
        Insert: {
          ciphertext: string
          created_at?: string
          field_id: string
          id?: string
          project_integration_id: string
          updated_at?: string
        }
        Update: {
          ciphertext?: string
          created_at?: string
          field_id?: string
          id?: string
          project_integration_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_integration_secrets_project_integration_id_fkey"
            columns: ["project_integration_id"]
            isOneToOne: false
            referencedRelation: "project_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_integrations: {
        Row: {
          file_manifest: Json
          id: string
          installed_at: string
          integration_code: string
          options: Json
          project_id: string
          updated_at: string
          version: string
        }
        Insert: {
          file_manifest?: Json
          id?: string
          installed_at?: string
          integration_code: string
          options?: Json
          project_id: string
          updated_at?: string
          version?: string
        }
        Update: {
          file_manifest?: Json
          id?: string
          installed_at?: string
          integration_code?: string
          options?: Json
          project_id?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      project_versions: {
        Row: {
          created_at: string
          files: Json
          id: string
          label: string | null
          origin: string
          project_id: string
          summary: string | null
        }
        Insert: {
          created_at?: string
          files: Json
          id?: string
          label?: string | null
          origin?: string
          project_id: string
          summary?: string | null
        }
        Update: {
          created_at?: string
          files?: Json
          id?: string
          label?: string | null
          origin?: string
          project_id?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          created_at: string
          custom_instructions: string | null
          id: string
          is_featured: boolean
          is_public: boolean
          latest_build_id: string | null
          owner_id: string
          primary_domain_id: string | null
          published_at: string | null
          published_build_id: string | null
          published_visibility: string
          remix_count: number
          remixed_from_id: string | null
          slug: string
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_instructions?: string | null
          id?: string
          is_featured?: boolean
          is_public?: boolean
          latest_build_id?: string | null
          owner_id: string
          primary_domain_id?: string | null
          published_at?: string | null
          published_build_id?: string | null
          published_visibility?: string
          remix_count?: number
          remixed_from_id?: string | null
          slug: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_instructions?: string | null
          id?: string
          is_featured?: boolean
          is_public?: boolean
          latest_build_id?: string | null
          owner_id?: string
          primary_domain_id?: string | null
          published_at?: string | null
          published_build_id?: string | null
          published_visibility?: string
          remix_count?: number
          remixed_from_id?: string | null
          slug?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_latest_build_id_fkey"
            columns: ["latest_build_id"]
            isOneToOne: false
            referencedRelation: "project_builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_primary_domain_id_fkey"
            columns: ["primary_domain_id"]
            isOneToOne: false
            referencedRelation: "project_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_remixed_from_id_fkey"
            columns: ["remixed_from_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          id: string
          payload: Json | null
          processed_at: string
          type: string
        }
        Insert: {
          id: string
          payload?: Json | null
          processed_at?: string
          type: string
        }
        Update: {
          id?: string
          payload?: Json | null
          processed_at?: string
          type?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          pending_plan_code: string | null
          plan_code: string
          price_id: string
          product_id: string | null
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          pending_plan_code?: string | null
          plan_code: string
          price_id: string
          product_id?: string | null
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          pending_plan_code?: string | null
          plan_code?: string
          price_id?: string
          product_id?: string | null
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      system_settings: {
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
      topup_lots: {
        Row: {
          created_at: string
          credits_granted: number
          credits_remaining: number
          environment: string
          expires_at: string
          id: string
          pack_code: string
          stripe_session_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_granted: number
          credits_remaining: number
          environment?: string
          expires_at: string
          id?: string
          pack_code: string
          stripe_session_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits_granted?: number
          credits_remaining?: number
          environment?: string
          expires_at?: string
          id?: string
          pack_code?: string
          stripe_session_id?: string | null
          updated_at?: string
          user_id?: string
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
      user_wallets: {
        Row: {
          created_at: string
          current_period_end: string | null
          daily_free_reset_at: string
          daily_free_used: number
          monthly_credits_remaining: number
          monthly_free_reset_at: string
          monthly_free_used: number
          pending_plan_change_at: string | null
          pending_plan_code: string | null
          plan_code: string
          preferred_currency: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          topup_credits_remaining: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          daily_free_reset_at?: string
          daily_free_used?: number
          monthly_credits_remaining?: number
          monthly_free_reset_at?: string
          monthly_free_used?: number
          pending_plan_change_at?: string | null
          pending_plan_code?: string | null
          plan_code?: string
          preferred_currency?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          topup_credits_remaining?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          daily_free_reset_at?: string
          daily_free_used?: number
          monthly_credits_remaining?: number
          monthly_free_reset_at?: string
          monthly_free_used?: number
          pending_plan_change_at?: string | null
          pending_plan_code?: string | null
          plan_code?: string
          preferred_currency?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          topup_credits_remaining?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_wallets_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "billing_plans"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "user_wallets_preferred_currency_fkey"
            columns: ["preferred_currency"]
            isOneToOne: false
            referencedRelation: "billing_currencies"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      v_build_costs: {
        Row: {
          entries: number | null
          first_at: string | null
          gross_spent: number | null
          last_at: string | null
          net_spent: number | null
          project_id: string | null
          refunded: number | null
          user_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_deduct_credits: {
        Args: { _amount: number; _reason?: string; _user_id: string }
        Returns: string
      }
      admin_grant_credits: {
        Args: {
          _amount: number
          _bucket?: string
          _reason?: string
          _user_id: string
        }
        Returns: undefined
      }
      admin_list_transactions: {
        Args: {
          _limit?: number
          _offset?: number
          _purpose?: string
          _search?: string
          _status?: string
        }
        Returns: {
          amount_minor: number
          channel: string
          created_at: string
          currency_code: string
          environment: string
          id: string
          item_code: string
          paid_at: string
          paystack_reference: string
          purpose: string
          reference: string
          status: string
          total_count: number
          usd_amount_cents: number
          user_email: string
          user_id: string
        }[]
      }
      admin_list_users: {
        Args: { _limit?: number; _offset?: number; _search?: string }
        Returns: {
          avatar_url: string
          created_at: string
          daily_free_used: number
          display_name: string
          email: string
          is_admin: boolean
          monthly_credits_remaining: number
          plan_code: string
          topup_credits_remaining: number
          total_count: number
          user_id: string
        }[]
      }
      admin_refund_ledger: {
        Args: { _ledger_id: string; _reason?: string; _user_id: string }
        Returns: boolean
      }
      admin_set_user_role: {
        Args: {
          _grant: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      apply_monthly_renewal: {
        Args: {
          _current_period_end: string
          _plan_code: string
          _user_id: string
        }
        Returns: undefined
      }
      apply_paystack_backend_slot: {
        Args: {
          _addon_code: string
          _amount_minor: number
          _currency_code: string
          _environment: string
          _project_id: string
          _reference: string
          _user_id: string
        }
        Returns: string
      }
      apply_paystack_domain_slot: {
        Args: {
          _addon_code: string
          _amount_minor: number
          _currency_code: string
          _environment: string
          _project_id: string
          _reference: string
          _user_id: string
        }
        Returns: string
      }
      apply_paystack_plan_grant: {
        Args: { _plan_code: string; _reference: string; _user_id: string }
        Returns: undefined
      }
      apply_paystack_topup: {
        Args: {
          _environment: string
          _pack_code: string
          _reference: string
          _user_id: string
        }
        Returns: undefined
      }
      apply_period_end_changes: { Args: never; Returns: undefined }
      apply_subscription_activated: {
        Args: {
          _current_period_end: string
          _plan_code: string
          _stripe_customer_id: string
          _stripe_subscription_id: string
          _user_id: string
        }
        Returns: undefined
      }
      apply_topup_purchase: {
        Args: {
          _environment: string
          _pack_code: string
          _stripe_session_id: string
          _user_id: string
        }
        Returns: undefined
      }
      check_credit_balance: {
        Args: { _amount: number; _user_id: string }
        Returns: boolean
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      expire_backend_slots: { Args: never; Returns: undefined }
      expire_domain_slots: { Args: never; Returns: undefined }
      expire_paystack_plans: { Args: never; Returns: undefined }
      expire_topup_lots: { Args: never; Returns: undefined }
      grant_credits: {
        Args: {
          _amount: number
          _bucket: string
          _metadata?: Json
          _reason: string
          _user_id: string
        }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      reap_stalled_builds: { Args: never; Returns: undefined }
      refund_credit: {
        Args: {
          _ledger_id: string
          _metadata?: Json
          _reason?: string
          _user_id: string
        }
        Returns: boolean
      }
      replace_project_files: {
        Args: { _files: Json; _project_id: string }
        Returns: undefined
      }
      set_user_plan: {
        Args: {
          _current_period_end?: string
          _plan_code: string
          _stripe_customer_id?: string
          _stripe_subscription_id?: string
          _subscription_status?: string
          _user_id: string
        }
        Returns: undefined
      }
      spend_credit:
        | {
            Args: {
              _amount: number
              _metadata?: Json
              _project_id?: string
              _reason?: string
              _user_id: string
            }
            Returns: string
          }
        | {
            Args: {
              _metadata?: Json
              _project_id?: string
              _reason?: string
              _user_id: string
            }
            Returns: boolean
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
