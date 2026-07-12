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
      ai_call_log: {
        Row: {
          cached_prompt_tokens: number | null
          chosen_by: string | null
          completion_tokens: number | null
          cost_usd_micro: number | null
          created_at: string
          error_message: string | null
          fallback_used: boolean
          feature: string
          files_sent: number | null
          had_attachments: boolean
          id: string
          latency_ms: number | null
          model: string | null
          phase: string | null
          project_id: string | null
          prompt_chars: number | null
          prompt_tokens: number | null
          provider: string
          static_prefix_chars: number | null
          static_prefix_hash: string | null
          status: number
          total_tokens: number | null
          user_id: string | null
        }
        Insert: {
          cached_prompt_tokens?: number | null
          chosen_by?: string | null
          completion_tokens?: number | null
          cost_usd_micro?: number | null
          created_at?: string
          error_message?: string | null
          fallback_used?: boolean
          feature: string
          files_sent?: number | null
          had_attachments?: boolean
          id?: string
          latency_ms?: number | null
          model?: string | null
          phase?: string | null
          project_id?: string | null
          prompt_chars?: number | null
          prompt_tokens?: number | null
          provider: string
          static_prefix_chars?: number | null
          static_prefix_hash?: string | null
          status: number
          total_tokens?: number | null
          user_id?: string | null
        }
        Update: {
          cached_prompt_tokens?: number | null
          chosen_by?: string | null
          completion_tokens?: number | null
          cost_usd_micro?: number | null
          created_at?: string
          error_message?: string | null
          fallback_used?: boolean
          feature?: string
          files_sent?: number | null
          had_attachments?: boolean
          id?: string
          latency_ms?: number | null
          model?: string | null
          phase?: string | null
          project_id?: string | null
          prompt_chars?: number | null
          prompt_tokens?: number | null
          provider?: string
          static_prefix_chars?: number | null
          static_prefix_hash?: string | null
          status?: number
          total_tokens?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_call_outcomes: {
        Row: {
          ai_call_id: string
          autofix_count: number
          build_id: string | null
          build_status: string | null
          created_at: string
          feature: string
          files_written: number | null
          id: string
          local_verifier_errors: Json
          local_verifier_pass: boolean | null
          message_id: string | null
          model: string | null
          project_id: string | null
          provider: string
          updated_at: string
          user_followup_was_fix: boolean | null
        }
        Insert: {
          ai_call_id: string
          autofix_count?: number
          build_id?: string | null
          build_status?: string | null
          created_at?: string
          feature: string
          files_written?: number | null
          id?: string
          local_verifier_errors?: Json
          local_verifier_pass?: boolean | null
          message_id?: string | null
          model?: string | null
          project_id?: string | null
          provider: string
          updated_at?: string
          user_followup_was_fix?: boolean | null
        }
        Update: {
          ai_call_id?: string
          autofix_count?: number
          build_id?: string | null
          build_status?: string | null
          created_at?: string
          feature?: string
          files_written?: number | null
          id?: string
          local_verifier_errors?: Json
          local_verifier_pass?: boolean | null
          message_id?: string | null
          model?: string | null
          project_id?: string | null
          provider?: string
          updated_at?: string
          user_followup_was_fix?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_outcomes_ai_call_id_fkey"
            columns: ["ai_call_id"]
            isOneToOne: false
            referencedRelation: "ai_call_log"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_provider_settings: {
        Row: {
          fallback_model: string | null
          feature: string
          model: string | null
          provider: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          fallback_model?: string | null
          feature: string
          model?: string | null
          provider: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          fallback_model?: string | null
          feature?: string
          model?: string | null
          provider?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      ai_router_config: {
        Row: {
          enabled: boolean
          exploration_pct: number
          id: number
          min_samples: number
          updated_at: string
          updated_by: string | null
          window_hours: number
        }
        Insert: {
          enabled?: boolean
          exploration_pct?: number
          id?: number
          min_samples?: number
          updated_at?: string
          updated_by?: string | null
          window_hours?: number
        }
        Update: {
          enabled?: boolean
          exploration_pct?: number
          id?: number
          min_samples?: number
          updated_at?: string
          updated_by?: string | null
          window_hours?: number
        }
        Relationships: []
      }
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
          paystack_interval: string
          paystack_plan_code_ghs: string | null
          paystack_plan_code_kes: string | null
          paystack_plan_code_ngn: string | null
          paystack_plan_code_usd: string | null
          paystack_plan_code_zar: string | null
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
          paystack_interval?: string
          paystack_plan_code_ghs?: string | null
          paystack_plan_code_kes?: string | null
          paystack_plan_code_ngn?: string | null
          paystack_plan_code_usd?: string | null
          paystack_plan_code_zar?: string | null
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
          paystack_interval?: string
          paystack_plan_code_ghs?: string | null
          paystack_plan_code_kes?: string | null
          paystack_plan_code_ngn?: string | null
          paystack_plan_code_usd?: string | null
          paystack_plan_code_zar?: string | null
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
      coffee_tips: {
        Row: {
          amount_minor: number
          created_at: string
          currency_code: string
          environment: string | null
          id: string
          message: string | null
          paid_at: string | null
          reference: string
          status: string
          supporter_email: string
          supporter_name: string | null
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency_code: string
          environment?: string | null
          id?: string
          message?: string | null
          paid_at?: string | null
          reference: string
          status?: string
          supporter_email: string
          supporter_name?: string | null
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency_code?: string
          environment?: string | null
          id?: string
          message?: string | null
          paid_at?: string | null
          reference?: string
          status?: string
          supporter_email?: string
          supporter_name?: string | null
        }
        Relationships: []
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
      integration_docs_cache: {
        Row: {
          display_name: string
          docs_url: string | null
          fetched_at: string
          hit_count: number
          homepage_url: string | null
          id: string
          meta: Json
          npm_package: string | null
          prompt_block: string
          refreshed_at: string
          required_secrets: Json
          service_slug: string
          source: string
        }
        Insert: {
          display_name: string
          docs_url?: string | null
          fetched_at?: string
          hit_count?: number
          homepage_url?: string | null
          id?: string
          meta?: Json
          npm_package?: string | null
          prompt_block: string
          refreshed_at?: string
          required_secrets?: Json
          service_slug: string
          source: string
        }
        Update: {
          display_name?: string
          docs_url?: string | null
          fetched_at?: string
          hit_count?: number
          homepage_url?: string | null
          id?: string
          meta?: Json
          npm_package?: string | null
          prompt_block?: string
          refreshed_at?: string
          required_secrets?: Json
          service_slug?: string
          source?: string
        }
        Relationships: []
      }
      invest_pledges: {
        Row: {
          amount_usd_intended: number | null
          contact_pref: string | null
          created_at: string
          email: string
          id: string
          ip: unknown
          name: string
          note: string | null
          user_agent: string | null
        }
        Insert: {
          amount_usd_intended?: number | null
          contact_pref?: string | null
          created_at?: string
          email: string
          id?: string
          ip?: unknown
          name: string
          note?: string | null
          user_agent?: string | null
        }
        Update: {
          amount_usd_intended?: number | null
          contact_pref?: string | null
          created_at?: string
          email?: string
          id?: string
          ip?: unknown
          name?: string
          note?: string | null
          user_agent?: string | null
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
      message_drafts: {
        Row: {
          partial_content: string
          partial_plan: string
          partial_recap: string
          project_id: string
          updated_at: string
        }
        Insert: {
          partial_content?: string
          partial_plan?: string
          partial_recap?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          partial_content?: string
          partial_plan?: string
          partial_recap?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_drafts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      mobile_apps: {
        Row: {
          bundle_id: string | null
          codemagic_app_id: string | null
          created_at: string
          default_branch: string
          github_default_branch: string
          github_repo: string | null
          id: string
          latest_build_id: string | null
          project_id: string
          signing_profile_id: string | null
          updated_at: string
          workflow_id: string
        }
        Insert: {
          bundle_id?: string | null
          codemagic_app_id?: string | null
          created_at?: string
          default_branch?: string
          github_default_branch?: string
          github_repo?: string | null
          id?: string
          latest_build_id?: string | null
          project_id: string
          signing_profile_id?: string | null
          updated_at?: string
          workflow_id?: string
        }
        Update: {
          bundle_id?: string | null
          codemagic_app_id?: string | null
          created_at?: string
          default_branch?: string
          github_default_branch?: string
          github_repo?: string | null
          id?: string
          latest_build_id?: string | null
          project_id?: string
          signing_profile_id?: string | null
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mobile_apps_latest_build_fk"
            columns: ["latest_build_id"]
            isOneToOne: false
            referencedRelation: "mobile_builds"
            referencedColumns: ["id"]
          },
        ]
      }
      mobile_builds: {
        Row: {
          actual_cost_usd: number | null
          artifact_url: string | null
          codemagic_build_id: string | null
          created_at: string
          error_message: string | null
          estimated_cost_usd: number
          finished_at: string | null
          id: string
          kind: string
          mobile_app_id: string
          platform: string
          project_id: string
          signing_profile_id: string | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_cost_usd?: number | null
          artifact_url?: string | null
          codemagic_build_id?: string | null
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number
          finished_at?: string | null
          id?: string
          kind: string
          mobile_app_id: string
          platform: string
          project_id: string
          signing_profile_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_cost_usd?: number | null
          artifact_url?: string | null
          codemagic_build_id?: string | null
          created_at?: string
          error_message?: string | null
          estimated_cost_usd?: number
          finished_at?: string | null
          id?: string
          kind?: string
          mobile_app_id?: string
          platform?: string
          project_id?: string
          signing_profile_id?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mobile_builds_mobile_app_id_fkey"
            columns: ["mobile_app_id"]
            isOneToOne: false
            referencedRelation: "mobile_apps"
            referencedColumns: ["id"]
          },
        ]
      }
      mobile_signing_profiles: {
        Row: {
          android_key_alias: string | null
          android_key_password_ciphertext: string | null
          android_keystore_ciphertext: string | null
          android_keystore_password_ciphertext: string | null
          android_play_service_account_ciphertext: string | null
          apple_app_store_connect_issuer_id: string | null
          apple_app_store_connect_key_ciphertext: string | null
          apple_app_store_connect_key_id: string | null
          apple_bundle_id: string | null
          apple_p12_ciphertext: string | null
          apple_p12_not_after: string | null
          apple_p12_password_ciphertext: string | null
          apple_provisioning_profile_ciphertext: string | null
          apple_provisioning_profile_not_after: string | null
          apple_team_id: string | null
          created_at: string
          id: string
          project_id: string
          updated_at: string
        }
        Insert: {
          android_key_alias?: string | null
          android_key_password_ciphertext?: string | null
          android_keystore_ciphertext?: string | null
          android_keystore_password_ciphertext?: string | null
          android_play_service_account_ciphertext?: string | null
          apple_app_store_connect_issuer_id?: string | null
          apple_app_store_connect_key_ciphertext?: string | null
          apple_app_store_connect_key_id?: string | null
          apple_bundle_id?: string | null
          apple_p12_ciphertext?: string | null
          apple_p12_not_after?: string | null
          apple_p12_password_ciphertext?: string | null
          apple_provisioning_profile_ciphertext?: string | null
          apple_provisioning_profile_not_after?: string | null
          apple_team_id?: string | null
          created_at?: string
          id?: string
          project_id: string
          updated_at?: string
        }
        Update: {
          android_key_alias?: string | null
          android_key_password_ciphertext?: string | null
          android_keystore_ciphertext?: string | null
          android_keystore_password_ciphertext?: string | null
          android_play_service_account_ciphertext?: string | null
          apple_app_store_connect_issuer_id?: string | null
          apple_app_store_connect_key_ciphertext?: string | null
          apple_app_store_connect_key_id?: string | null
          apple_bundle_id?: string | null
          apple_p12_ciphertext?: string | null
          apple_p12_not_after?: string | null
          apple_p12_password_ciphertext?: string | null
          apple_provisioning_profile_ciphertext?: string | null
          apple_provisioning_profile_not_after?: string | null
          apple_team_id?: string | null
          created_at?: string
          id?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      page_views: {
        Row: {
          country: string | null
          created_at: string
          created_day: string | null
          id: number
          path: string
          project_id: string
          referrer: string | null
          user_agent: string | null
          visitor_hash: string | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          created_day?: string | null
          id?: number
          path?: string
          project_id: string
          referrer?: string | null
          user_agent?: string | null
          visitor_hash?: string | null
        }
        Update: {
          country?: string | null
          created_at?: string
          created_day?: string | null
          id?: number
          path?: string
          project_id?: string
          referrer?: string | null
          user_agent?: string | null
          visitor_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "page_views_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      page_views_daily: {
        Row: {
          day: string
          project_id: string
          unique_visitors: number
          views: number
        }
        Insert: {
          day: string
          project_id: string
          unique_visitors?: number
          views?: number
        }
        Update: {
          day?: string
          project_id?: string
          unique_visitors?: number
          views?: number
        }
        Relationships: [
          {
            foreignKeyName: "page_views_daily_project_id_fkey"
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
      paystack_invoices: {
        Row: {
          amount_minor: number
          created_at: string
          currency_code: string
          description: string | null
          event_payload: Json
          id: string
          invoice_code: string
          paid_at: string | null
          paystack_reference: string | null
          status: string
          subscription_code: string
          user_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          currency_code: string
          description?: string | null
          event_payload?: Json
          id?: string
          invoice_code: string
          paid_at?: string | null
          paystack_reference?: string | null
          status: string
          subscription_code: string
          user_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          currency_code?: string
          description?: string | null
          event_payload?: Json
          id?: string
          invoice_code?: string
          paid_at?: string | null
          paystack_reference?: string | null
          status?: string
          subscription_code?: string
          user_id?: string
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
      pending_secret_requests: {
        Row: {
          conversation_id: string | null
          created_at: string
          fulfilled_at: string | null
          id: string
          instructions: string | null
          link: string | null
          project_id: string
          secret_name: string
          status: string
          updated_at: string
        }
        Insert: {
          conversation_id?: string | null
          created_at?: string
          fulfilled_at?: string | null
          id?: string
          instructions?: string | null
          link?: string | null
          project_id: string
          secret_name: string
          status?: string
          updated_at?: string
        }
        Update: {
          conversation_id?: string | null
          created_at?: string
          fulfilled_at?: string | null
          id?: string
          instructions?: string | null
          link?: string | null
          project_id?: string
          secret_name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      petal_email_outbound: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string | null
          metadata: Json
          project_id: string
          recipient_email: string
          resend_message_id: string | null
          status: string
          subject: string | null
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          project_id: string
          recipient_email: string
          resend_message_id?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json
          project_id?: string
          recipient_email?: string
          resend_message_id?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      petal_email_subscriptions: {
        Row: {
          api_token_hash: string
          api_token_prefix: string
          created_at: string
          current_period_end: string
          current_period_start: string
          custom_domain: string | null
          custom_domain_verified: boolean
          daily_cap: number
          id: string
          monthly_cap: number
          paystack_reference: string | null
          plan: string
          project_id: string
          reply_to: string | null
          resend_domain_id: string | null
          sender_email: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_token_hash: string
          api_token_prefix: string
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          custom_domain?: string | null
          custom_domain_verified?: boolean
          daily_cap?: number
          id?: string
          monthly_cap?: number
          paystack_reference?: string | null
          plan?: string
          project_id: string
          reply_to?: string | null
          resend_domain_id?: string | null
          sender_email?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_token_hash?: string
          api_token_prefix?: string
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          custom_domain?: string | null
          custom_domain_verified?: boolean
          daily_cap?: number
          id?: string
          monthly_cap?: number
          paystack_reference?: string | null
          plan?: string
          project_id?: string
          reply_to?: string | null
          resend_domain_id?: string | null
          sender_email?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      petal_email_suppressions: {
        Row: {
          created_at: string
          id: string
          project_id: string
          reason: string
          recipient_email: string
          source_message_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          reason: string
          recipient_email: string
          source_message_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          reason?: string
          recipient_email?: string
          source_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "petal_email_suppressions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      petal_email_usage: {
        Row: {
          created_at: string
          failed_count: number
          id: string
          project_id: string
          sent_count: number
          updated_at: string
          usage_date: string
        }
        Insert: {
          created_at?: string
          failed_count?: number
          id?: string
          project_id: string
          sent_count?: number
          updated_at?: string
          usage_date?: string
        }
        Update: {
          created_at?: string
          failed_count?: number
          id?: string
          project_id?: string
          sent_count?: number
          updated_at?: string
          usage_date?: string
        }
        Relationships: []
      }
      petal_plans: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          payload: Json
          project_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string
          id?: string
          payload: Json
          project_id: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          payload?: Json
          project_id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      petal_runtime_errors: {
        Row: {
          build_id: string | null
          colno: number | null
          created_at: string
          id: string
          kind: string
          lineno: number | null
          message: string
          page_url: string | null
          project_id: string
          source: string | null
          stack: string | null
          user_agent: string | null
        }
        Insert: {
          build_id?: string | null
          colno?: number | null
          created_at?: string
          id?: string
          kind: string
          lineno?: number | null
          message: string
          page_url?: string | null
          project_id: string
          source?: string | null
          stack?: string | null
          user_agent?: string | null
        }
        Update: {
          build_id?: string | null
          colno?: number | null
          created_at?: string
          id?: string
          kind?: string
          lineno?: number | null
          message?: string
          page_url?: string | null
          project_id?: string
          source?: string | null
          stack?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "petal_runtime_errors_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      petal_self_learning_digests: {
        Row: {
          avg_autofix_count: number | null
          build_success_rate: number | null
          created_at: string
          email_error: string | null
          email_recipients: string[] | null
          email_sent_at: string | null
          followup_was_fix_rate: number | null
          generated_at: string
          id: string
          model_breakdown: Json
          payload: Json
          period_date: string
          recommendations: Json
          timeout_rate: number | null
          top_failure_signatures: Json
          top_reverted_prompts: Json
          total_projects: number
          total_turns: number
          total_users: number
          updated_at: string
          verifier_pass_rate: number | null
        }
        Insert: {
          avg_autofix_count?: number | null
          build_success_rate?: number | null
          created_at?: string
          email_error?: string | null
          email_recipients?: string[] | null
          email_sent_at?: string | null
          followup_was_fix_rate?: number | null
          generated_at?: string
          id?: string
          model_breakdown?: Json
          payload?: Json
          period_date: string
          recommendations?: Json
          timeout_rate?: number | null
          top_failure_signatures?: Json
          top_reverted_prompts?: Json
          total_projects?: number
          total_turns?: number
          total_users?: number
          updated_at?: string
          verifier_pass_rate?: number | null
        }
        Update: {
          avg_autofix_count?: number | null
          build_success_rate?: number | null
          created_at?: string
          email_error?: string | null
          email_recipients?: string[] | null
          email_sent_at?: string | null
          followup_was_fix_rate?: number | null
          generated_at?: string
          id?: string
          model_breakdown?: Json
          payload?: Json
          period_date?: string
          recommendations?: Json
          timeout_rate?: number | null
          top_failure_signatures?: Json
          top_reverted_prompts?: Json
          total_projects?: number
          total_turns?: number
          total_users?: number
          updated_at?: string
          verifier_pass_rate?: number | null
        }
        Relationships: []
      }
      pipeline_failures: {
        Row: {
          created_at: string
          extra: Json
          id: string
          model: string | null
          project_id: string | null
          raw_message: string
          signature: string
          stream_tail: string | null
          surface: string
          tool_name: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          extra?: Json
          id?: string
          model?: string | null
          project_id?: string | null
          raw_message: string
          signature: string
          stream_tail?: string | null
          surface: string
          tool_name?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          extra?: Json
          id?: string
          model?: string | null
          project_id?: string | null
          raw_message?: string
          signature?: string
          stream_tail?: string | null
          surface?: string
          tool_name?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      pipeline_tier_events: {
        Row: {
          created_at: string
          details: Json
          duration_ms: number
          id: string
          issue_count: number
          message_id: string | null
          model: string | null
          outcome: string
          project_id: string | null
          tier: string
          tier_order: number
          turn_id: string
        }
        Insert: {
          created_at?: string
          details?: Json
          duration_ms?: number
          id?: string
          issue_count?: number
          message_id?: string | null
          model?: string | null
          outcome: string
          project_id?: string | null
          tier: string
          tier_order: number
          turn_id: string
        }
        Update: {
          created_at?: string
          details?: Json
          duration_ms?: number
          id?: string
          issue_count?: number
          message_id?: string | null
          model?: string | null
          outcome?: string
          project_id?: string | null
          tier?: string
          tier_order?: number
          turn_id?: string
        }
        Relationships: []
      }
      preview_comments: {
        Row: {
          author_name: string | null
          body: string
          created_at: string
          id: string
          page_path: string
          project_id: string
          resolved_at: string | null
          selector: string | null
          share_id: string
          status: string
          viewport_width: number | null
          x_pct: number | null
          y_pct: number | null
        }
        Insert: {
          author_name?: string | null
          body: string
          created_at?: string
          id?: string
          page_path?: string
          project_id: string
          resolved_at?: string | null
          selector?: string | null
          share_id: string
          status?: string
          viewport_width?: number | null
          x_pct?: number | null
          y_pct?: number | null
        }
        Update: {
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
          page_path?: string
          project_id?: string
          resolved_at?: string | null
          selector?: string | null
          share_id?: string
          status?: string
          viewport_width?: number | null
          x_pct?: number | null
          y_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "preview_comments_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "preview_comments_share_id_fkey"
            columns: ["share_id"]
            isOneToOne: false
            referencedRelation: "preview_shares"
            referencedColumns: ["id"]
          },
        ]
      }
      preview_shares: {
        Row: {
          allow_comments: boolean
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          project_id: string
          revoked_at: string | null
          token: string
        }
        Insert: {
          allow_comments?: boolean
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          project_id: string
          revoked_at?: string | null
          token: string
        }
        Update: {
          allow_comments?: boolean
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          project_id?: string
          revoked_at?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "preview_shares_project_id_fkey"
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
      project_backend_migrations: {
        Row: {
          applied_at: string
          applied_status: string
          content_hash: string
          error_message: string | null
          id: string
          migration_path: string
          project_id: string
        }
        Insert: {
          applied_at?: string
          applied_status: string
          content_hash: string
          error_message?: string | null
          id?: string
          migration_path: string
          project_id: string
        }
        Update: {
          applied_at?: string
          applied_status?: string
          content_hash?: string
          error_message?: string | null
          id?: string
          migration_path?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_backend_migrations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_backend_secrets: {
        Row: {
          project_id: string
          service_role_key: string | null
          updated_at: string
        }
        Insert: {
          project_id: string
          service_role_key?: string | null
          updated_at?: string
        }
        Update: {
          project_id?: string
          service_role_key?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_backend_secrets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      project_blueprints: {
        Row: {
          backend: string | null
          blueprint: Json
          created_at: string
          design_language: string | null
          files: string[]
          id: string
          navigation: string[]
          project_id: string
          project_type: string
          sections: string[]
          updated_at: string
        }
        Insert: {
          backend?: string | null
          blueprint?: Json
          created_at?: string
          design_language?: string | null
          files?: string[]
          id?: string
          navigation?: string[]
          project_id: string
          project_type?: string
          sections?: string[]
          updated_at?: string
        }
        Update: {
          backend?: string | null
          blueprint?: Json
          created_at?: string
          design_language?: string | null
          files?: string[]
          id?: string
          navigation?: string[]
          project_id?: string
          project_type?: string
          sections?: string[]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_blueprints_project_id_fkey"
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
          last_retry_at: string | null
          project_id: string
          ready_at: string | null
          retry_count: number
          status: string
        }
        Insert: {
          created_at?: string
          dist_path?: string | null
          error_message?: string | null
          id?: string
          last_retry_at?: string | null
          project_id: string
          ready_at?: string | null
          retry_count?: number
          status?: string
        }
        Update: {
          created_at?: string
          dist_path?: string | null
          error_message?: string | null
          id?: string
          last_retry_at?: string | null
          project_id?: string
          ready_at?: string | null
          retry_count?: number
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
          verification_records: Json
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
          verification_records?: Json
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
          verification_records?: Json
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
      project_memory: {
        Row: {
          created_at: string
          id: string
          key: string
          project_id: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          project_id: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          project_id?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      project_secrets: {
        Row: {
          ciphertext: string
          created_at: string
          id: string
          name: string
          project_id: string
          updated_at: string
        }
        Insert: {
          ciphertext: string
          created_at?: string
          id?: string
          name: string
          project_id: string
          updated_at?: string
        }
        Update: {
          ciphertext?: string
          created_at?: string
          id?: string
          name?: string
          project_id?: string
          updated_at?: string
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
          hide_petal_badge: boolean
          id: string
          is_featured: boolean
          is_public: boolean
          is_starred: boolean
          latest_build_id: string | null
          owner_id: string
          primary_domain_id: string | null
          published_at: string | null
          published_build_id: string | null
          published_visibility: string
          remix_count: number
          remixed_from_id: string | null
          runtime_grace_until: string | null
          runtime_paused: boolean
          site_description: string | null
          site_icon_url: string | null
          site_og_image_url: string | null
          site_title: string | null
          slug: string
          spend_cap_cents: number | null
          subdomain: string | null
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_instructions?: string | null
          hide_petal_badge?: boolean
          id?: string
          is_featured?: boolean
          is_public?: boolean
          is_starred?: boolean
          latest_build_id?: string | null
          owner_id: string
          primary_domain_id?: string | null
          published_at?: string | null
          published_build_id?: string | null
          published_visibility?: string
          remix_count?: number
          remixed_from_id?: string | null
          runtime_grace_until?: string | null
          runtime_paused?: boolean
          site_description?: string | null
          site_icon_url?: string | null
          site_og_image_url?: string | null
          site_title?: string | null
          slug: string
          spend_cap_cents?: number | null
          subdomain?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_instructions?: string | null
          hide_petal_badge?: boolean
          id?: string
          is_featured?: boolean
          is_public?: boolean
          is_starred?: boolean
          latest_build_id?: string | null
          owner_id?: string
          primary_domain_id?: string | null
          published_at?: string | null
          published_build_id?: string | null
          published_visibility?: string
          remix_count?: number
          remixed_from_id?: string | null
          runtime_grace_until?: string | null
          runtime_paused?: boolean
          site_description?: string | null
          site_icon_url?: string | null
          site_og_image_url?: string | null
          site_title?: string | null
          slug?: string
          spend_cap_cents?: number | null
          subdomain?: string | null
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
      purchased_domains: {
        Row: {
          auto_renew: boolean
          cf_registration_id: string | null
          cf_registration_resource_link: string | null
          cf_state: string | null
          charged_cents: number
          charged_minor: number
          connected_domain_id: string | null
          created_at: string
          currency_code: string
          error_message: string | null
          expires_at: string | null
          hostname: string
          id: string
          last_polled_at: string | null
          paystack_reference: string | null
          project_id: string
          registered_at: string | null
          status: string
          tier: string | null
          updated_at: string
          user_id: string
          wholesale_cost_cents: number
        }
        Insert: {
          auto_renew?: boolean
          cf_registration_id?: string | null
          cf_registration_resource_link?: string | null
          cf_state?: string | null
          charged_cents: number
          charged_minor: number
          connected_domain_id?: string | null
          created_at?: string
          currency_code: string
          error_message?: string | null
          expires_at?: string | null
          hostname: string
          id?: string
          last_polled_at?: string | null
          paystack_reference?: string | null
          project_id: string
          registered_at?: string | null
          status?: string
          tier?: string | null
          updated_at?: string
          user_id: string
          wholesale_cost_cents: number
        }
        Update: {
          auto_renew?: boolean
          cf_registration_id?: string | null
          cf_registration_resource_link?: string | null
          cf_state?: string | null
          charged_cents?: number
          charged_minor?: number
          connected_domain_id?: string | null
          created_at?: string
          currency_code?: string
          error_message?: string | null
          expires_at?: string | null
          hostname?: string
          id?: string
          last_polled_at?: string | null
          paystack_reference?: string | null
          project_id?: string
          registered_at?: string | null
          status?: string
          tier?: string | null
          updated_at?: string
          user_id?: string
          wholesale_cost_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchased_domains_connected_domain_id_fkey"
            columns: ["connected_domain_id"]
            isOneToOne: false
            referencedRelation: "project_domains"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchased_domains_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      runtime_ledger: {
        Row: {
          created_at: string
          delta_cents: number
          free_after_cents: number
          id: string
          metadata: Json
          meter: string
          project_id: string | null
          topup_after_cents: number
          user_id: string
        }
        Insert: {
          created_at?: string
          delta_cents: number
          free_after_cents: number
          id?: string
          metadata?: Json
          meter: string
          project_id?: string | null
          topup_after_cents: number
          user_id: string
        }
        Update: {
          created_at?: string
          delta_cents?: number
          free_after_cents?: number
          id?: string
          metadata?: Json
          meter?: string
          project_id?: string | null
          topup_after_cents?: number
          user_id?: string
        }
        Relationships: []
      }
      runtime_topup_packs: {
        Row: {
          amount_cents: number
          code: string
          created_at: string
          currency_code: string
          display_amount_minor: number
          is_active: boolean
          label: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          amount_cents: number
          code: string
          created_at?: string
          currency_code: string
          display_amount_minor: number
          is_active?: boolean
          label: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          code?: string
          created_at?: string
          currency_code?: string
          display_amount_minor?: number
          is_active?: boolean
          label?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
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
          next_payment_date: string | null
          paystack_authorization_code: string | null
          paystack_customer_code: string | null
          paystack_email_token: string | null
          paystack_subscription_code: string | null
          pending_plan_code: string | null
          plan_code: string
          price_id: string | null
          product_id: string | null
          provider: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
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
          next_payment_date?: string | null
          paystack_authorization_code?: string | null
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          pending_plan_code?: string | null
          plan_code: string
          price_id?: string | null
          product_id?: string | null
          provider?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
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
          next_payment_date?: string | null
          paystack_authorization_code?: string | null
          paystack_customer_code?: string | null
          paystack_email_token?: string | null
          paystack_subscription_code?: string | null
          pending_plan_code?: string | null
          plan_code?: string
          price_id?: string | null
          product_id?: string | null
          provider?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
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
      turn_events: {
        Row: {
          created_at: string
          id: string
          kind: string
          payload: Json
          seq: number
          turn_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          seq: number
          turn_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          seq?: number
          turn_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "turn_events_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: false
            referencedRelation: "turns"
            referencedColumns: ["id"]
          },
        ]
      }
      turns: {
        Row: {
          created_at: string
          credits_charged: number | null
          ended_at: string | null
          error_message: string | null
          id: string
          last_seq: number
          project_id: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_charged?: number | null
          ended_at?: string | null
          error_message?: string | null
          id?: string
          last_seq?: number
          project_id: string
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits_charged?: number | null
          ended_at?: string | null
          error_message?: string | null
          id?: string
          last_seq?: number
          project_id?: string
          started_at?: string
          status?: string
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
          runtime_first_plan_grant_at: string | null
          runtime_free_balance_cents: number
          runtime_free_reset_at: string
          runtime_topup_balance_cents: number
          runtime_topup_qualified_at: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
          topup_credits_remaining: number
          updated_at: string
          user_id: string
          workspace_cap_cents: number | null
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
          runtime_first_plan_grant_at?: string | null
          runtime_free_balance_cents?: number
          runtime_free_reset_at?: string
          runtime_topup_balance_cents?: number
          runtime_topup_qualified_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          topup_credits_remaining?: number
          updated_at?: string
          user_id: string
          workspace_cap_cents?: number | null
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
          runtime_first_plan_grant_at?: string | null
          runtime_free_balance_cents?: number
          runtime_free_reset_at?: string
          runtime_topup_balance_cents?: number
          runtime_topup_qualified_at?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
          topup_credits_remaining?: number
          updated_at?: string
          user_id?: string
          workspace_cap_cents?: number | null
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
      ai_model_quality: {
        Row: {
          avg_autofixes: number | null
          build_success_rate: number | null
          feature: string | null
          followup_fix_rate: number | null
          last_seen_at: string | null
          model: string | null
          provider: string | null
          samples: number | null
          verifier_pass_rate: number | null
        }
        Relationships: []
      }
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
      admin_grant_credit: {
        Args: { _amount: number; _note?: string; _target_user_id: string }
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
      apply_paystack_runtime_topup: {
        Args: {
          _amount_cents: number
          _metadata?: Json
          _reference: string
          _user_id: string
        }
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
      can_enable_managed_backend: {
        Args: { _user_id: string }
        Returns: boolean
      }
      cancel_paystack_plan: {
        Args: { _subscription_code: string; _user_id: string }
        Returns: undefined
      }
      charge_runtime: {
        Args: {
          _amount_cents: number
          _metadata?: Json
          _meter: string
          _project_id: string
          _user_id: string
        }
        Returns: {
          free_after: number
          ok: boolean
          reason: string
          topup_after: number
        }[]
      }
      check_credit_balance: {
        Args: { _amount: number; _user_id: string }
        Returns: boolean
      }
      credit_runtime: {
        Args: {
          _amount_cents: number
          _bucket?: string
          _metadata?: Json
          _meter: string
          _user_id: string
        }
        Returns: undefined
      }
      decrement_petal_email_usage: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      expire_backend_slots: { Args: never; Returns: undefined }
      expire_domain_slots: { Args: never; Returns: undefined }
      expire_paystack_plans: { Args: never; Returns: undefined }
      expire_topup_lots: { Args: never; Returns: undefined }
      get_preview_share_by_token: {
        Args: { _token: string }
        Returns: {
          allow_comments: boolean
          created_at: string
          created_by: string
          expires_at: string
          id: string
          project_id: string
          revoked_at: string
          token: string
        }[]
      }
      get_project_pageview_stats: {
        Args: { _project_id: string }
        Returns: {
          views_24h: number
          views_30d: number
          views_7d: number
          visitors_30d: number
          visitors_7d: number
        }[]
      }
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
      grant_first_paid_plan_runtime_credit: {
        Args: { _plan_code: string; _reference: string; _user_id: string }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_petal_email_usage: {
        Args: {
          p_daily_cap: number
          p_monthly_cap: number
          p_project_id: string
        }
        Returns: {
          allowed: boolean
          daily_used: number
          monthly_used: number
          reason: string
        }[]
      }
      is_paid_plan: { Args: { _user_id: string }; Returns: boolean }
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
      record_page_view: {
        Args: {
          _country: string
          _path: string
          _project_id: string
          _referrer: string
          _user_agent: string
          _visitor_hash: string
        }
        Returns: undefined
      }
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
      runtime_apply_monthly_grant: { Args: never; Returns: undefined }
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
