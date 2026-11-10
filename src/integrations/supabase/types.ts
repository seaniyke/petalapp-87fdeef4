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
      agent_runs: {
        Row: {
          agent: string
          attempts: number
          complexity: number
          cost_micro_usd: number
          created_at: string
          decisions: number
          error: string | null
          id: string
          ms: number
          objections: number
          optional: boolean
          profile: string
          project_id: string | null
          status: string
          turn_id: string
          user_id: string | null
        }
        Insert: {
          agent: string
          attempts?: number
          complexity?: number
          cost_micro_usd?: number
          created_at?: string
          decisions?: number
          error?: string | null
          id?: string
          ms?: number
          objections?: number
          optional?: boolean
          profile: string
          project_id?: string | null
          status: string
          turn_id: string
          user_id?: string | null
        }
        Update: {
          agent?: string
          attempts?: number
          complexity?: number
          cost_micro_usd?: number
          created_at?: string
          decisions?: number
          error?: string | null
          id?: string
          ms?: number
          objections?: number
          optional?: boolean
          profile?: string
          project_id?: string | null
          status?: string
          turn_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ai_call_log: {
        Row: {
          attempt_id: string | null
          attempt_state: string | null
          build_id: string | null
          cache_write_tokens: number | null
          cached_prompt_tokens: number | null
          call_class: string | null
          call_kind: string | null
          chosen_by: string | null
          completion_tokens: number | null
          cost_basis: string
          cost_source: string | null
          cost_usd_micro: number | null
          created_at: string
          error_message: string | null
          fallback_from_upstream: string | null
          fallback_number: number | null
          fallback_used: boolean
          feature: string
          files_affected: string[] | null
          files_sent: number | null
          finish_reason: string | null
          first_token_ms: number | null
          generated_files: boolean | null
          had_attachments: boolean
          id: string
          invoke_reason: string | null
          key_owner: string
          last_token_ms: number | null
          latency_ms: number | null
          model: string | null
          operation_id: string | null
          parent_stage: string | null
          phase: string | null
          project_id: string | null
          prompt_chars: number | null
          prompt_tokens: number | null
          provider: string
          purpose: string | null
          reasoning_tokens: number | null
          recovery_reason: string | null
          request_id: string | null
          revision: number | null
          session_id: string | null
          stage: string | null
          stall_ms: number | null
          static_prefix_chars: number | null
          static_prefix_hash: string | null
          status: number
          stream_outcome: string | null
          stream_total_ms: number | null
          total_tokens: number | null
          turn_id: string | null
          upstream_provider: string | null
          usage_state: string | null
          user_id: string | null
        }
        Insert: {
          attempt_id?: string | null
          attempt_state?: string | null
          build_id?: string | null
          cache_write_tokens?: number | null
          cached_prompt_tokens?: number | null
          call_class?: string | null
          call_kind?: string | null
          chosen_by?: string | null
          completion_tokens?: number | null
          cost_basis?: string
          cost_source?: string | null
          cost_usd_micro?: number | null
          created_at?: string
          error_message?: string | null
          fallback_from_upstream?: string | null
          fallback_number?: number | null
          fallback_used?: boolean
          feature: string
          files_affected?: string[] | null
          files_sent?: number | null
          finish_reason?: string | null
          first_token_ms?: number | null
          generated_files?: boolean | null
          had_attachments?: boolean
          id?: string
          invoke_reason?: string | null
          key_owner?: string
          last_token_ms?: number | null
          latency_ms?: number | null
          model?: string | null
          operation_id?: string | null
          parent_stage?: string | null
          phase?: string | null
          project_id?: string | null
          prompt_chars?: number | null
          prompt_tokens?: number | null
          provider: string
          purpose?: string | null
          reasoning_tokens?: number | null
          recovery_reason?: string | null
          request_id?: string | null
          revision?: number | null
          session_id?: string | null
          stage?: string | null
          stall_ms?: number | null
          static_prefix_chars?: number | null
          static_prefix_hash?: string | null
          status: number
          stream_outcome?: string | null
          stream_total_ms?: number | null
          total_tokens?: number | null
          turn_id?: string | null
          upstream_provider?: string | null
          usage_state?: string | null
          user_id?: string | null
        }
        Update: {
          attempt_id?: string | null
          attempt_state?: string | null
          build_id?: string | null
          cache_write_tokens?: number | null
          cached_prompt_tokens?: number | null
          call_class?: string | null
          call_kind?: string | null
          chosen_by?: string | null
          completion_tokens?: number | null
          cost_basis?: string
          cost_source?: string | null
          cost_usd_micro?: number | null
          created_at?: string
          error_message?: string | null
          fallback_from_upstream?: string | null
          fallback_number?: number | null
          fallback_used?: boolean
          feature?: string
          files_affected?: string[] | null
          files_sent?: number | null
          finish_reason?: string | null
          first_token_ms?: number | null
          generated_files?: boolean | null
          had_attachments?: boolean
          id?: string
          invoke_reason?: string | null
          key_owner?: string
          last_token_ms?: number | null
          latency_ms?: number | null
          model?: string | null
          operation_id?: string | null
          parent_stage?: string | null
          phase?: string | null
          project_id?: string | null
          prompt_chars?: number | null
          prompt_tokens?: number | null
          provider?: string
          purpose?: string | null
          reasoning_tokens?: number | null
          recovery_reason?: string | null
          request_id?: string | null
          revision?: number | null
          session_id?: string | null
          stage?: string | null
          stall_ms?: number | null
          static_prefix_chars?: number | null
          static_prefix_hash?: string | null
          status?: number
          stream_outcome?: string | null
          stream_total_ms?: number | null
          total_tokens?: number | null
          turn_id?: string | null
          upstream_provider?: string | null
          usage_state?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_log_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "economic_operations"
            referencedColumns: ["id"]
          },
        ]
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
          budget_enabled: boolean | null
          budget_models: string[] | null
          fallback_model: string | null
          feature: string
          model: string | null
          provider: string
          shadow_pct: number | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          budget_enabled?: boolean | null
          budget_models?: string[] | null
          fallback_model?: string | null
          feature: string
          model?: string | null
          provider: string
          shadow_pct?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          budget_enabled?: boolean | null
          budget_models?: string[] | null
          fallback_model?: string | null
          feature?: string
          model?: string | null
          provider?: string
          shadow_pct?: number | null
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
      balance_alerts: {
        Row: {
          alerted_at: string | null
          last_balance: number | null
          threshold: number
          updated_at: string
          user_id: string
        }
        Insert: {
          alerted_at?: string | null
          last_balance?: number | null
          threshold: number
          updated_at?: string
          user_id: string
        }
        Update: {
          alerted_at?: string | null
          last_balance?: number | null
          threshold?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      benchmark_cases: {
        Row: {
          build_completed: boolean
          build_id: string | null
          case_id: string
          classification: string | null
          created_at: string
          criteria: Json
          defects: Json
          duration_ms: number | null
          error_message: string | null
          functional_correctness: number | null
          id: string
          project_id: string | null
          prompt: string
          regression_safety: number | null
          run_id: string
          spec_adherence: number | null
          status: string
          telemetry: Json
          title: string
          visual_quality: number | null
        }
        Insert: {
          build_completed?: boolean
          build_id?: string | null
          case_id: string
          classification?: string | null
          created_at?: string
          criteria?: Json
          defects?: Json
          duration_ms?: number | null
          error_message?: string | null
          functional_correctness?: number | null
          id?: string
          project_id?: string | null
          prompt: string
          regression_safety?: number | null
          run_id: string
          spec_adherence?: number | null
          status?: string
          telemetry?: Json
          title: string
          visual_quality?: number | null
        }
        Update: {
          build_completed?: boolean
          build_id?: string | null
          case_id?: string
          classification?: string | null
          created_at?: string
          criteria?: Json
          defects?: Json
          duration_ms?: number | null
          error_message?: string | null
          functional_correctness?: number | null
          id?: string
          project_id?: string | null
          prompt?: string
          regression_safety?: number | null
          run_id?: string
          spec_adherence?: number | null
          status?: string
          telemetry?: Json
          title?: string
          visual_quality?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "benchmark_cases_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "benchmark_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      benchmark_runs: {
        Row: {
          build_completion: number | null
          completed_cases: number
          error_message: string | null
          finished_at: string | null
          functional_correctness: number | null
          id: string
          overall_score: number | null
          regression_safety: number | null
          regressions: Json
          spec_adherence: number | null
          started_at: string
          status: string
          total_cases: number
          trigger: string
          visual_quality: number | null
        }
        Insert: {
          build_completion?: number | null
          completed_cases?: number
          error_message?: string | null
          finished_at?: string | null
          functional_correctness?: number | null
          id?: string
          overall_score?: number | null
          regression_safety?: number | null
          regressions?: Json
          spec_adherence?: number | null
          started_at?: string
          status?: string
          total_cases?: number
          trigger?: string
          visual_quality?: number | null
        }
        Update: {
          build_completion?: number | null
          completed_cases?: number
          error_message?: string | null
          finished_at?: string | null
          functional_correctness?: number | null
          id?: string
          overall_score?: number | null
          regression_safety?: number | null
          regressions?: Json
          spec_adherence?: number | null
          started_at?: string
          status?: string
          total_cases?: number
          trigger?: string
          visual_quality?: number | null
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
      build_checkpoints: {
        Row: {
          base_revision: number | null
          closed_at: string | null
          created_at: string
          id: string
          origin_turn_id: string
          pages: Json
          planned: Json
          preserved: Json
          project_id: string
          remaining: Json
          request: string
          resume_count: number
          shell: Json | null
          stage: string
          status: string
          terminal_outcome: string | null
          turn_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          base_revision?: number | null
          closed_at?: string | null
          created_at?: string
          id?: string
          origin_turn_id: string
          pages?: Json
          planned?: Json
          preserved?: Json
          project_id: string
          remaining?: Json
          request?: string
          resume_count?: number
          shell?: Json | null
          stage?: string
          status?: string
          terminal_outcome?: string | null
          turn_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          base_revision?: number | null
          closed_at?: string | null
          created_at?: string
          id?: string
          origin_turn_id?: string
          pages?: Json
          planned?: Json
          preserved?: Json
          project_id?: string
          remaining?: Json
          request?: string
          resume_count?: number
          shell?: Json | null
          stage?: string
          status?: string
          terminal_outcome?: string | null
          turn_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "build_checkpoints_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      coffee_tips: {
        Row: {
          amount_minor: number
          chain: string | null
          created_at: string
          currency_code: string
          environment: string | null
          id: string
          message: string | null
          method: string
          paid_at: string | null
          reference: string
          status: string
          supporter_email: string
          supporter_name: string | null
          tx_hash: string | null
          wallet_address: string | null
        }
        Insert: {
          amount_minor: number
          chain?: string | null
          created_at?: string
          currency_code: string
          environment?: string | null
          id?: string
          message?: string | null
          method?: string
          paid_at?: string | null
          reference: string
          status?: string
          supporter_email: string
          supporter_name?: string | null
          tx_hash?: string | null
          wallet_address?: string | null
        }
        Update: {
          amount_minor?: number
          chain?: string | null
          created_at?: string
          currency_code?: string
          environment?: string | null
          id?: string
          message?: string | null
          method?: string
          paid_at?: string | null
          reference?: string
          status?: string
          supporter_email?: string
          supporter_name?: string | null
          tx_hash?: string | null
          wallet_address?: string | null
        }
        Relationships: []
      }
      cost_events: {
        Row: {
          attribution: string | null
          build_id: string | null
          category: string
          cost_basis: string
          cost_usd: number | null
          created_at: string
          failed_work: boolean
          funded_by: string | null
          id: string
          metadata: Json
          operation_id: string | null
          project_id: string | null
          provider: string | null
          quantity: number | null
          resource: string | null
          revision: number | null
          source_ref: string | null
          stage: string | null
          turn_id: string | null
          unit: string | null
          user_id: string | null
        }
        Insert: {
          attribution?: string | null
          build_id?: string | null
          category: string
          cost_basis: string
          cost_usd?: number | null
          created_at?: string
          failed_work?: boolean
          funded_by?: string | null
          id?: string
          metadata?: Json
          operation_id?: string | null
          project_id?: string | null
          provider?: string | null
          quantity?: number | null
          resource?: string | null
          revision?: number | null
          source_ref?: string | null
          stage?: string | null
          turn_id?: string | null
          unit?: string | null
          user_id?: string | null
        }
        Update: {
          attribution?: string | null
          build_id?: string | null
          category?: string
          cost_basis?: string
          cost_usd?: number | null
          created_at?: string
          failed_work?: boolean
          funded_by?: string | null
          id?: string
          metadata?: Json
          operation_id?: string | null
          project_id?: string | null
          provider?: string | null
          quantity?: number | null
          resource?: string | null
          revision?: number | null
          source_ref?: string | null
          stage?: string | null
          turn_id?: string | null
          unit?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_events_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "economic_operations"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          attribution: string | null
          balance_after: number
          created_at: string
          credit_purpose: string | null
          delta: number
          id: string
          metadata: Json
          operation_id: string | null
          project_id: string | null
          reason: string
          turn_id: string | null
          user_id: string
        }
        Insert: {
          attribution?: string | null
          balance_after: number
          created_at?: string
          credit_purpose?: string | null
          delta: number
          id?: string
          metadata?: Json
          operation_id?: string | null
          project_id?: string | null
          reason: string
          turn_id?: string | null
          user_id: string
        }
        Update: {
          attribution?: string | null
          balance_after?: number
          created_at?: string
          credit_purpose?: string | null
          delta?: number
          id?: string
          metadata?: Json
          operation_id?: string | null
          project_id?: string | null
          reason?: string
          turn_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_ledger_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "economic_operations"
            referencedColumns: ["id"]
          },
        ]
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
      credit_paused_turns: {
        Row: {
          baseline_hash: string
          candidate_files: Json
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          id: string
          last_error: string | null
          original_request: string
          project_id: string
          required_credits: number
          result_payload: Json
          status: string
          turn_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          baseline_hash: string
          candidate_files: Json
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          original_request?: string
          project_id: string
          required_credits: number
          result_payload?: Json
          status?: string
          turn_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          baseline_hash?: string
          candidate_files?: Json
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          original_request?: string
          project_id?: string
          required_credits?: number
          result_payload?: Json
          status?: string
          turn_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_paused_turns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credit_paused_turns_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: true
            referencedRelation: "turns"
            referencedColumns: ["id"]
          },
        ]
      }
      crypto_payments: {
        Row: {
          admin_note: string | null
          amount_sent: number | null
          asset: string
          chain: string
          confirmations: number | null
          created_at: string
          credited_at: string | null
          detected_usd_cents: number | null
          environment: string
          id: string
          item_code: string
          last_checked_at: string | null
          purpose: string
          receipt_email_sent_at: string | null
          reference: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          tx_hash: string
          usd_amount_cents: number
          user_id: string
          verify_attempts: number
          verify_note: string | null
          wallet_address: string
        }
        Insert: {
          admin_note?: string | null
          amount_sent?: number | null
          asset: string
          chain: string
          confirmations?: number | null
          created_at?: string
          credited_at?: string | null
          detected_usd_cents?: number | null
          environment?: string
          id?: string
          item_code: string
          last_checked_at?: string | null
          purpose: string
          receipt_email_sent_at?: string | null
          reference: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tx_hash: string
          usd_amount_cents: number
          user_id: string
          verify_attempts?: number
          verify_note?: string | null
          wallet_address: string
        }
        Update: {
          admin_note?: string | null
          amount_sent?: number | null
          asset?: string
          chain?: string
          confirmations?: number | null
          created_at?: string
          credited_at?: string | null
          detected_usd_cents?: number | null
          environment?: string
          id?: string
          item_code?: string
          last_checked_at?: string | null
          purpose?: string
          receipt_email_sent_at?: string | null
          reference?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          tx_hash?: string
          usd_amount_cents?: number
          user_id?: string
          verify_attempts?: number
          verify_note?: string | null
          wallet_address?: string
        }
        Relationships: []
      }
      design_pictures: {
        Row: {
          active: boolean
          aspect_ratio: string
          colors: string[]
          created_at: string
          has_people: boolean
          id: string
          industry: string | null
          license: string
          location: string | null
          mood: string | null
          orientation: string
          source: string
          style: string | null
          subject: string
          tags: string[]
          tone: string | null
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          aspect_ratio?: string
          colors?: string[]
          created_at?: string
          has_people?: boolean
          id?: string
          industry?: string | null
          license?: string
          location?: string | null
          mood?: string | null
          orientation?: string
          source?: string
          style?: string | null
          subject: string
          tags?: string[]
          tone?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          aspect_ratio?: string
          colors?: string[]
          created_at?: string
          has_people?: boolean
          id?: string
          industry?: string | null
          license?: string
          location?: string | null
          mood?: string | null
          orientation?: string
          source?: string
          style?: string | null
          subject?: string
          tags?: string[]
          tone?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      developer_api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          owner_label: string | null
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          owner_label?: string | null
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          owner_label?: string | null
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: []
      }
      developer_key_projects: {
        Row: {
          created_at: string
          key_id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          key_id: string
          project_id: string
        }
        Update: {
          created_at?: string
          key_id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "developer_key_projects_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "developer_api_keys"
            referencedColumns: ["id"]
          },
        ]
      }
      domain_renewals: {
        Row: {
          charged_cents: number | null
          created_at: string
          credit_ledger_id: string | null
          credits: number | null
          error_code: string | null
          error_message: string | null
          hostname: string
          id: string
          new_expires_at: string | null
          payer: string
          prior_expires_at: string | null
          purchased_domain_id: string
          status: string
          trigger: string
          wholesale_cents: number | null
          years: number
        }
        Insert: {
          charged_cents?: number | null
          created_at?: string
          credit_ledger_id?: string | null
          credits?: number | null
          error_code?: string | null
          error_message?: string | null
          hostname: string
          id?: string
          new_expires_at?: string | null
          payer: string
          prior_expires_at?: string | null
          purchased_domain_id: string
          status: string
          trigger: string
          wholesale_cents?: number | null
          years: number
        }
        Update: {
          charged_cents?: number | null
          created_at?: string
          credit_ledger_id?: string | null
          credits?: number | null
          error_code?: string | null
          error_message?: string | null
          hostname?: string
          id?: string
          new_expires_at?: string | null
          payer?: string
          prior_expires_at?: string | null
          purchased_domain_id?: string
          status?: string
          trigger?: string
          wholesale_cents?: number | null
          years?: number
        }
        Relationships: [
          {
            foreignKeyName: "domain_renewals_purchased_domain_id_fkey"
            columns: ["purchased_domain_id"]
            isOneToOne: false
            referencedRelation: "purchased_domains"
            referencedColumns: ["id"]
          },
        ]
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
      economic_operations: {
        Row: {
          attribution: string
          base_revision: number | null
          build_attempts: number
          build_revision: number | null
          committed_revision: number | null
          created_at: string
          credit_purpose: string
          credits_charged: number
          credits_estimated: number | null
          credits_refunded: number
          credits_reserved: number | null
          economics_cohort: string | null
          failure_class: string | null
          free_credits_charged: number
          id: string
          metadata: Json
          operation_type: string
          outcome: string | null
          paid_credits_charged: number
          project_id: string
          published_revision: number | null
          settlement_state: string
          turn_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attribution?: string
          base_revision?: number | null
          build_attempts?: number
          build_revision?: number | null
          committed_revision?: number | null
          created_at?: string
          credit_purpose?: string
          credits_charged?: number
          credits_estimated?: number | null
          credits_refunded?: number
          credits_reserved?: number | null
          economics_cohort?: string | null
          failure_class?: string | null
          free_credits_charged?: number
          id?: string
          metadata?: Json
          operation_type?: string
          outcome?: string | null
          paid_credits_charged?: number
          project_id: string
          published_revision?: number | null
          settlement_state?: string
          turn_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attribution?: string
          base_revision?: number | null
          build_attempts?: number
          build_revision?: number | null
          committed_revision?: number | null
          created_at?: string
          credit_purpose?: string
          credits_charged?: number
          credits_estimated?: number | null
          credits_refunded?: number
          credits_reserved?: number | null
          economics_cohort?: string | null
          failure_class?: string | null
          free_credits_charged?: number
          id?: string
          metadata?: Json
          operation_type?: string
          outcome?: string | null
          paid_credits_charged?: number
          project_id?: string
          published_revision?: number | null
          settlement_state?: string
          turn_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "economic_operations_turn_id_fkey"
            columns: ["turn_id"]
            isOneToOne: true
            referencedRelation: "turns"
            referencedColumns: ["id"]
          },
        ]
      }
      economics_config: {
        Row: {
          description: string | null
          key: string
          unit: string
          updated_at: string
          value: number
        }
        Insert: {
          description?: string | null
          key: string
          unit?: string
          updated_at?: string
          value: number
        }
        Update: {
          description?: string | null
          key?: string
          unit?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
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
      generated_pictures: {
        Row: {
          active: boolean
          aspect_ratio: string
          cache_key: string | null
          category: string | null
          created_at: string
          height: number | null
          id: string
          industry: string | null
          model: string | null
          mood: string | null
          orientation: string
          owner_id: string | null
          project_id: string | null
          prompt: string
          provider: string | null
          shared: boolean
          style: string | null
          subject: string
          tags: string[]
          turn_id: string | null
          updated_at: string
          url: string
          visual_traits: string[]
          width: number | null
        }
        Insert: {
          active?: boolean
          aspect_ratio?: string
          cache_key?: string | null
          category?: string | null
          created_at?: string
          height?: number | null
          id?: string
          industry?: string | null
          model?: string | null
          mood?: string | null
          orientation?: string
          owner_id?: string | null
          project_id?: string | null
          prompt: string
          provider?: string | null
          shared?: boolean
          style?: string | null
          subject?: string
          tags?: string[]
          turn_id?: string | null
          updated_at?: string
          url: string
          visual_traits?: string[]
          width?: number | null
        }
        Update: {
          active?: boolean
          aspect_ratio?: string
          cache_key?: string | null
          category?: string | null
          created_at?: string
          height?: number | null
          id?: string
          industry?: string | null
          model?: string | null
          mood?: string | null
          orientation?: string
          owner_id?: string | null
          project_id?: string | null
          prompt?: string
          provider?: string | null
          shared?: boolean
          style?: string | null
          subject?: string
          tags?: string[]
          turn_id?: string | null
          updated_at?: string
          url?: string
          visual_traits?: string[]
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "generated_pictures_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      infra_services: {
        Row: {
          allocation_method: string | null
          confidence: string
          created_at: string
          id: string
          monthly_fixed_usd: number | null
          notes: string | null
          per_turn_allocation_possible: boolean
          plan: string | null
          service: string
          updated_at: string
          usage_components: string | null
          usage_metrics: string | null
        }
        Insert: {
          allocation_method?: string | null
          confidence?: string
          created_at?: string
          id?: string
          monthly_fixed_usd?: number | null
          notes?: string | null
          per_turn_allocation_possible?: boolean
          plan?: string | null
          service: string
          updated_at?: string
          usage_components?: string | null
          usage_metrics?: string | null
        }
        Update: {
          allocation_method?: string | null
          confidence?: string
          created_at?: string
          id?: string
          monthly_fixed_usd?: number | null
          notes?: string | null
          per_turn_allocation_possible?: boolean
          plan?: string | null
          service?: string
          updated_at?: string
          usage_components?: string | null
          usage_metrics?: string | null
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
      marketplace_config: {
        Row: {
          commission_bps: number
          id: boolean
          min_payout_cents: number
          payouts_enabled: boolean
          updated_at: string
        }
        Insert: {
          commission_bps?: number
          id?: boolean
          min_payout_cents?: number
          payouts_enabled?: boolean
          updated_at?: string
        }
        Update: {
          commission_bps?: number
          id?: boolean
          min_payout_cents?: number
          payouts_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      marketplace_earnings: {
        Row: {
          commission_cents: number
          created_at: string
          creator_id: string
          gross_cents: number
          id: string
          listing_id: string | null
          listing_slug: string
          net_cents: number
          payout_id: string | null
          payout_state: string
          purchase_id: string
        }
        Insert: {
          commission_cents?: number
          created_at?: string
          creator_id: string
          gross_cents?: number
          id?: string
          listing_id?: string | null
          listing_slug?: string
          net_cents?: number
          payout_id?: string | null
          payout_state?: string
          purchase_id: string
        }
        Update: {
          commission_cents?: number
          created_at?: string
          creator_id?: string
          gross_cents?: number
          id?: string
          listing_id?: string | null
          listing_slug?: string
          net_cents?: number
          payout_id?: string | null
          payout_state?: string
          purchase_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_earnings_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_earnings_payout_fk"
            columns: ["payout_id"]
            isOneToOne: false
            referencedRelation: "marketplace_payouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_earnings_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: true
            referencedRelation: "marketplace_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_licenses: {
        Row: {
          code: string
          created_at: string
          is_public: boolean
          name: string
          redistribute_allowed: boolean
          resale_allowed: boolean
          rights: string[]
          sort_order: number
          summary: string
          white_label_allowed: boolean
        }
        Insert: {
          code: string
          created_at?: string
          is_public?: boolean
          name: string
          redistribute_allowed?: boolean
          resale_allowed?: boolean
          rights?: string[]
          sort_order?: number
          summary: string
          white_label_allowed?: boolean
        }
        Update: {
          code?: string
          created_at?: string
          is_public?: boolean
          name?: string
          redistribute_allowed?: boolean
          resale_allowed?: boolean
          rights?: string[]
          sort_order?: number
          summary?: string
          white_label_allowed?: boolean
        }
        Relationships: []
      }
      marketplace_listings: {
        Row: {
          category: string
          cover_url: string | null
          created_at: string
          creator_id: string
          currency_code: string
          demo_url: string | null
          description: string
          file_count: number
          id: string
          license_code: string
          open_count: number
          pitch: string
          price_minor: number
          project_id: string | null
          published_at: string | null
          rating_avg: number
          rating_count: number
          review_note: string | null
          sales_count: number
          screenshots: string[]
          slug: string
          source_files: Json
          source_version_id: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          category?: string
          cover_url?: string | null
          created_at?: string
          creator_id: string
          currency_code?: string
          demo_url?: string | null
          description?: string
          file_count?: number
          id?: string
          license_code?: string
          open_count?: number
          pitch?: string
          price_minor?: number
          project_id?: string | null
          published_at?: string | null
          rating_avg?: number
          rating_count?: number
          review_note?: string | null
          sales_count?: number
          screenshots?: string[]
          slug: string
          source_files?: Json
          source_version_id?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          category?: string
          cover_url?: string | null
          created_at?: string
          creator_id?: string
          currency_code?: string
          demo_url?: string | null
          description?: string
          file_count?: number
          id?: string
          license_code?: string
          open_count?: number
          pitch?: string
          price_minor?: number
          project_id?: string | null
          published_at?: string | null
          rating_avg?: number
          rating_count?: number
          review_note?: string | null
          sales_count?: number
          screenshots?: string[]
          slug?: string
          source_files?: Json
          source_version_id?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_license_code_fkey"
            columns: ["license_code"]
            isOneToOne: false
            referencedRelation: "marketplace_licenses"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "marketplace_listings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_listings_source_version_id_fkey"
            columns: ["source_version_id"]
            isOneToOne: false
            referencedRelation: "project_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_payouts: {
        Row: {
          admin_note: string | null
          amount_cents: number
          creator_id: string
          decided_at: string | null
          destination: string
          id: string
          method: string
          paid_at: string | null
          requested_at: string
          status: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          amount_cents: number
          creator_id: string
          decided_at?: string | null
          destination: string
          id?: string
          method?: string
          paid_at?: string | null
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          amount_cents?: number
          creator_id?: string
          decided_at?: string | null
          destination?: string
          id?: string
          method?: string
          paid_at?: string | null
          requested_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      marketplace_purchases: {
        Row: {
          buyer_id: string
          created_at: string
          creator_id: string
          creator_net_cents: number
          currency_code: string
          id: string
          license_code: string
          listing_id: string
          listing_slug: string
          listing_title: string
          platform_fee_cents: number
          price_minor: number
          reference: string | null
          source: string
          usd_amount_cents: number
        }
        Insert: {
          buyer_id: string
          created_at?: string
          creator_id: string
          creator_net_cents?: number
          currency_code?: string
          id?: string
          license_code: string
          listing_id: string
          listing_slug: string
          listing_title: string
          platform_fee_cents?: number
          price_minor?: number
          reference?: string | null
          source?: string
          usd_amount_cents?: number
        }
        Update: {
          buyer_id?: string
          created_at?: string
          creator_id?: string
          creator_net_cents?: number
          currency_code?: string
          id?: string
          license_code?: string
          listing_id?: string
          listing_slug?: string
          listing_title?: string
          platform_fee_cents?: number
          price_minor?: number
          reference?: string | null
          source?: string
          usd_amount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_purchases_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_reviews: {
        Row: {
          body: string
          created_at: string
          id: string
          listing_id: string
          listing_slug: string
          rating: number
          reviewer_id: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          listing_id: string
          listing_slug: string
          rating: number
          reviewer_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          listing_id?: string
          listing_slug?: string
          rating?: number
          reviewer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_reviews_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listings"
            referencedColumns: ["id"]
          },
        ]
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
      petal_repair_ledger: {
        Row: {
          build_id: string | null
          created_at: string
          detail: string | null
          id: string
          outcome: string
          pass_id: string
          phase: string
          project_id: string | null
          signature: string
          user_id: string | null
        }
        Insert: {
          build_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          outcome: string
          pass_id: string
          phase: string
          project_id?: string | null
          signature: string
          user_id?: string | null
        }
        Update: {
          build_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          outcome?: string
          pass_id?: string
          phase?: string
          project_id?: string | null
          signature?: string
          user_id?: string | null
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
          attempt_id: string | null
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
          attempt_id?: string | null
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
          attempt_id?: string | null
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
          economy_mode: boolean | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          economy_mode?: boolean | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          economy_mode?: boolean | null
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
          delete_warned_at: string | null
          error_message: string | null
          health_checked_at: string | null
          id: string
          last_active_at: string | null
          pause_reason: string | null
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
          delete_warned_at?: string | null
          error_message?: string | null
          health_checked_at?: string | null
          id?: string
          last_active_at?: string | null
          pause_reason?: string | null
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
          delete_warned_at?: string | null
          error_message?: string | null
          health_checked_at?: string | null
          id?: string
          last_active_at?: string | null
          pause_reason?: string | null
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
      project_badge_removals: {
        Row: {
          created_at: string
          credits: number
          ledger_id: string | null
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits: number
          ledger_id?: string | null
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits?: number
          ledger_id?: string | null
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_badge_removals_project_id_fkey"
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
          attribution: string | null
          browser_ms: number | null
          build_attempt: number | null
          builder_job_id: string | null
          compile_ms: number | null
          created_at: string
          deploy_ms: number | null
          deployed: boolean | null
          dist_path: string | null
          error_message: string | null
          failure_class: string | null
          id: string
          install_ms: number | null
          last_progress_at: string | null
          last_retry_at: string | null
          operation_id: string | null
          progress_label: string | null
          project_id: string
          project_revision: number | null
          ready_at: string | null
          retry_count: number
          stale_reason: string | null
          status: string
          turn_id: string | null
          verification: Json | null
        }
        Insert: {
          attribution?: string | null
          browser_ms?: number | null
          build_attempt?: number | null
          builder_job_id?: string | null
          compile_ms?: number | null
          created_at?: string
          deploy_ms?: number | null
          deployed?: boolean | null
          dist_path?: string | null
          error_message?: string | null
          failure_class?: string | null
          id?: string
          install_ms?: number | null
          last_progress_at?: string | null
          last_retry_at?: string | null
          operation_id?: string | null
          progress_label?: string | null
          project_id: string
          project_revision?: number | null
          ready_at?: string | null
          retry_count?: number
          stale_reason?: string | null
          status?: string
          turn_id?: string | null
          verification?: Json | null
        }
        Update: {
          attribution?: string | null
          browser_ms?: number | null
          build_attempt?: number | null
          builder_job_id?: string | null
          compile_ms?: number | null
          created_at?: string
          deploy_ms?: number | null
          deployed?: boolean | null
          dist_path?: string | null
          error_message?: string | null
          failure_class?: string | null
          id?: string
          install_ms?: number | null
          last_progress_at?: string | null
          last_retry_at?: string | null
          operation_id?: string | null
          progress_label?: string | null
          project_id?: string
          project_revision?: number | null
          ready_at?: string | null
          retry_count?: number
          stale_reason?: string | null
          status?: string
          turn_id?: string | null
          verification?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "project_builds_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "economic_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_builds_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_compute: {
        Row: {
          awake_since: string | null
          billed_through: string | null
          created_at: string
          environment_id: string | null
          error_message: string | null
          id: string
          last_active_at: string | null
          metadata: Json
          owner_id: string
          project_id: string
          provider: string
          region: string | null
          service_id: string | null
          service_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          awake_since?: string | null
          billed_through?: string | null
          created_at?: string
          environment_id?: string | null
          error_message?: string | null
          id?: string
          last_active_at?: string | null
          metadata?: Json
          owner_id: string
          project_id: string
          provider?: string
          region?: string | null
          service_id?: string | null
          service_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          awake_since?: string | null
          billed_through?: string | null
          created_at?: string
          environment_id?: string | null
          error_message?: string | null
          id?: string
          last_active_at?: string | null
          metadata?: Json
          owner_id?: string
          project_id?: string
          provider?: string
          region?: string | null
          service_id?: string | null
          service_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_compute_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
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
      project_edit_history: {
        Row: {
          audit: Json
          build_id: string | null
          change_set: Json
          changed_paths: Json
          complete: boolean
          created_at: string
          focus: Json | null
          id: string
          preserve: Json
          project_id: string
          revert_to: Json | null
          turn_id: string | null
          updated_at: string
          user_request: string
        }
        Insert: {
          audit?: Json
          build_id?: string | null
          change_set?: Json
          changed_paths?: Json
          complete?: boolean
          created_at?: string
          focus?: Json | null
          id?: string
          preserve?: Json
          project_id: string
          revert_to?: Json | null
          turn_id?: string | null
          updated_at?: string
          user_request?: string
        }
        Update: {
          audit?: Json
          build_id?: string | null
          change_set?: Json
          changed_paths?: Json
          complete?: boolean
          created_at?: string
          focus?: Json | null
          id?: string
          preserve?: Json
          project_id?: string
          revert_to?: Json | null
          turn_id?: string | null
          updated_at?: string
          user_request?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_edit_history_project_id_fkey"
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
      project_git_links: {
        Row: {
          access_token: string
          auto_sync: boolean
          branch: string
          created_at: string
          id: string
          last_commit_sha: string | null
          last_error: string | null
          last_synced_at: string | null
          project_id: string
          provider: string
          repo_full_name: string
          updated_at: string
        }
        Insert: {
          access_token: string
          auto_sync?: boolean
          branch?: string
          created_at?: string
          id?: string
          last_commit_sha?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          project_id: string
          provider?: string
          repo_full_name: string
          updated_at?: string
        }
        Update: {
          access_token?: string
          auto_sync?: boolean
          branch?: string
          created_at?: string
          id?: string
          last_commit_sha?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          project_id?: string
          provider?: string
          repo_full_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_git_links_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
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
      project_intelligence: {
        Row: {
          context: Json
          created_at: string
          project_id: string
          revision: number
          updated_at: string
        }
        Insert: {
          context?: Json
          created_at?: string
          project_id: string
          revision?: number
          updated_at?: string
        }
        Update: {
          context?: Json
          created_at?: string
          project_id?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_intelligence_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_intelligence_history: {
        Row: {
          context: Json
          created_at: string
          id: string
          project_id: string
          revision: number
          summary: string | null
          turn_id: string | null
        }
        Insert: {
          context: Json
          created_at?: string
          id?: string
          project_id: string
          revision: number
          summary?: string | null
          turn_id?: string | null
        }
        Update: {
          context?: Json
          created_at?: string
          id?: string
          project_id?: string
          revision?: number
          summary?: string | null
          turn_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_intelligence_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      project_pictures: {
        Row: {
          created_at: string
          id: string
          label: string
          project_id: string
          storage_path: string | null
          tags: string[]
          url: string
        }
        Insert: {
          created_at?: string
          id?: string
          label?: string
          project_id: string
          storage_path?: string | null
          tags?: string[]
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          project_id?: string
          storage_path?: string | null
          tags?: string[]
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_pictures_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      project_test_cases: {
        Row: {
          actual: string | null
          attempt: number
          case_key: string
          category: string
          console_errors: Json
          created_at: string
          duration_ms: number | null
          evidence: Json
          expected: string | null
          failed_requests: Json
          id: string
          page_errors: Json
          priority: string
          project_id: string
          reason: string | null
          run_id: string
          status: string
          title: string
          url: string | null
        }
        Insert: {
          actual?: string | null
          attempt?: number
          case_key: string
          category?: string
          console_errors?: Json
          created_at?: string
          duration_ms?: number | null
          evidence?: Json
          expected?: string | null
          failed_requests?: Json
          id?: string
          page_errors?: Json
          priority?: string
          project_id: string
          reason?: string | null
          run_id: string
          status?: string
          title: string
          url?: string | null
        }
        Update: {
          actual?: string | null
          attempt?: number
          case_key?: string
          category?: string
          console_errors?: Json
          created_at?: string
          duration_ms?: number | null
          evidence?: Json
          expected?: string | null
          failed_requests?: Json
          id?: string
          page_errors?: Json
          priority?: string
          project_id?: string
          reason?: string | null
          run_id?: string
          status?: string
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_test_cases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_test_cases_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "project_test_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      project_test_runs: {
        Row: {
          base_url: string | null
          blocked_reason: string | null
          budget: string
          build_id: string | null
          created_at: string
          finished_at: string | null
          id: string
          project_id: string
          started_at: string
          status: string
          totals: Json
          turn_id: string | null
          updated_at: string
        }
        Insert: {
          base_url?: string | null
          blocked_reason?: string | null
          budget?: string
          build_id?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          project_id: string
          started_at?: string
          status?: string
          totals?: Json
          turn_id?: string | null
          updated_at?: string
        }
        Update: {
          base_url?: string | null
          blocked_reason?: string | null
          budget?: string
          build_id?: string | null
          created_at?: string
          finished_at?: string | null
          id?: string
          project_id?: string
          started_at?: string
          status?: string
          totals?: Json
          turn_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_test_runs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_thumbnails: {
        Row: {
          build_id: string | null
          captured_at: string
          created_at: string
          height: number | null
          project_id: string
          storage_path: string | null
          updated_at: string
          url: string
          width: number | null
        }
        Insert: {
          build_id?: string | null
          captured_at?: string
          created_at?: string
          height?: number | null
          project_id: string
          storage_path?: string | null
          updated_at?: string
          url: string
          width?: number | null
        }
        Update: {
          build_id?: string | null
          captured_at?: string
          created_at?: string
          height?: number | null
          project_id?: string
          storage_path?: string | null
          updated_at?: string
          url?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_thumbnails_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_turn_completion: {
        Row: {
          accepted: boolean
          attempts: number
          created_at: string
          defect_fingerprint: string | null
          evidence: Json
          id: string
          last_build_id: string | null
          max_attempts: number
          outstanding_defects: Json
          project_id: string
          readiness: Json
          resume_after: string | null
          stage: string
          terminal_reason: string | null
          turn_id: string
          updated_at: string
          user_id: string
          verdict: string | null
        }
        Insert: {
          accepted?: boolean
          attempts?: number
          created_at?: string
          defect_fingerprint?: string | null
          evidence?: Json
          id?: string
          last_build_id?: string | null
          max_attempts?: number
          outstanding_defects?: Json
          project_id: string
          readiness?: Json
          resume_after?: string | null
          stage?: string
          terminal_reason?: string | null
          turn_id: string
          updated_at?: string
          user_id: string
          verdict?: string | null
        }
        Update: {
          accepted?: boolean
          attempts?: number
          created_at?: string
          defect_fingerprint?: string | null
          evidence?: Json
          id?: string
          last_build_id?: string | null
          max_attempts?: number
          outstanding_defects?: Json
          project_id?: string
          readiness?: Json
          resume_after?: string | null
          stage?: string
          terminal_reason?: string | null
          turn_id?: string
          updated_at?: string
          user_id?: string
          verdict?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_turn_completion_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_upgrade_events: {
        Row: {
          created_at: string
          detail: string | null
          id: string
          project_id: string
          reason: string
          rows_count: number | null
          status: string
          users_count: number | null
        }
        Insert: {
          created_at?: string
          detail?: string | null
          id?: string
          project_id: string
          reason: string
          rows_count?: number | null
          status: string
          users_count?: number | null
        }
        Update: {
          created_at?: string
          detail?: string | null
          id?: string
          project_id?: string
          reason?: string
          rows_count?: number | null
          status?: string
          users_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_upgrade_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
          auto_upgrade_notified_at: string | null
          auto_upgrade_opt_out: boolean
          backend_type: string
          cloud_tier_intent: string
          created_at: string
          custard_widget_tag: string | null
          custom_instructions: string | null
          external_user_id: string | null
          hide_petal_badge: boolean
          id: string
          is_featured: boolean
          is_public: boolean
          is_starred: boolean
          latest_build_id: string | null
          owner_id: string
          partner_paused: boolean
          primary_domain_id: string | null
          published_at: string | null
          published_build_id: string | null
          published_visibility: string
          remix_count: number
          remixed_from_id: string | null
          revision: number
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
          auto_upgrade_notified_at?: string | null
          auto_upgrade_opt_out?: boolean
          backend_type?: string
          cloud_tier_intent?: string
          created_at?: string
          custard_widget_tag?: string | null
          custom_instructions?: string | null
          external_user_id?: string | null
          hide_petal_badge?: boolean
          id?: string
          is_featured?: boolean
          is_public?: boolean
          is_starred?: boolean
          latest_build_id?: string | null
          owner_id: string
          partner_paused?: boolean
          primary_domain_id?: string | null
          published_at?: string | null
          published_build_id?: string | null
          published_visibility?: string
          remix_count?: number
          remixed_from_id?: string | null
          revision?: number
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
          auto_upgrade_notified_at?: string | null
          auto_upgrade_opt_out?: boolean
          backend_type?: string
          cloud_tier_intent?: string
          created_at?: string
          custard_widget_tag?: string | null
          custom_instructions?: string | null
          external_user_id?: string | null
          hide_petal_badge?: boolean
          id?: string
          is_featured?: boolean
          is_public?: boolean
          is_starred?: boolean
          latest_build_id?: string | null
          owner_id?: string
          partner_paused?: boolean
          primary_domain_id?: string | null
          published_at?: string | null
          published_build_id?: string | null
          published_visibility?: string
          remix_count?: number
          remixed_from_id?: string | null
          revision?: number
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
          last_renewed_at: string | null
          paystack_reference: string | null
          project_id: string
          registered_at: string | null
          renewal_error: string | null
          renewal_status: string | null
          status: string
          term_years: number
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
          last_renewed_at?: string | null
          paystack_reference?: string | null
          project_id: string
          registered_at?: string | null
          renewal_error?: string | null
          renewal_status?: string | null
          status?: string
          term_years?: number
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
          last_renewed_at?: string | null
          paystack_reference?: string | null
          project_id?: string
          registered_at?: string | null
          renewal_error?: string | null
          renewal_status?: string | null
          status?: string
          term_years?: number
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
      shared_app_password_resets: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          project_id: string
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          project_id: string
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          project_id?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      shared_app_records: {
        Row: {
          collection: string
          created_at: string
          data: Json
          id: string
          owner_key: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          collection: string
          created_at?: string
          data?: Json
          id?: string
          owner_key?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          collection?: string
          created_at?: string
          data?: Json
          id?: string
          owner_key?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_app_records_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_app_users: {
        Row: {
          created_at: string
          display_name: string | null
          email: string
          id: string
          password_hash: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          password_hash: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          password_hash?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_app_users_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_backends: {
        Row: {
          api_key: string
          created_at: string
          enabled_at: string
          last_active_at: string
          project_id: string
          row_count: number
          updated_at: string
        }
        Insert: {
          api_key: string
          created_at?: string
          enabled_at?: string
          last_active_at?: string
          project_id: string
          row_count?: number
          updated_at?: string
        }
        Update: {
          api_key?: string
          created_at?: string
          enabled_at?: string
          last_active_at?: string
          project_id?: string
          row_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_backends_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
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
      tool_loop_calls: {
        Row: {
          brief_chars: number | null
          cached_tokens: number | null
          call_class: string | null
          call_no: number
          compacted: boolean | null
          completed_at: string | null
          completion_tokens: number | null
          created_at: string
          duration_ms: number | null
          error: string | null
          files_read: string[] | null
          files_written: string[] | null
          finish_reason: string | null
          first_token_at: string | null
          history_chars: number | null
          id: string
          knowledge_chars: number | null
          model: string | null
          output_tps: number | null
          progress: boolean | null
          project_id: string | null
          prompt_tokens: number | null
          read_misses: number | null
          recovery: string | null
          request_started_at: string | null
          system_chars: number | null
          tool_calls: string[] | null
          tool_errors: number | null
          tool_ms: number | null
          ttft_ms: number | null
          turn_id: string | null
          uncached_tokens: number | null
          upstream_provider: string | null
          user_id: string | null
          validation_failures: number | null
          validation_ms: number | null
          work_unit: string | null
        }
        Insert: {
          brief_chars?: number | null
          cached_tokens?: number | null
          call_class?: string | null
          call_no: number
          compacted?: boolean | null
          completed_at?: string | null
          completion_tokens?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          files_read?: string[] | null
          files_written?: string[] | null
          finish_reason?: string | null
          first_token_at?: string | null
          history_chars?: number | null
          id?: string
          knowledge_chars?: number | null
          model?: string | null
          output_tps?: number | null
          progress?: boolean | null
          project_id?: string | null
          prompt_tokens?: number | null
          read_misses?: number | null
          recovery?: string | null
          request_started_at?: string | null
          system_chars?: number | null
          tool_calls?: string[] | null
          tool_errors?: number | null
          tool_ms?: number | null
          ttft_ms?: number | null
          turn_id?: string | null
          uncached_tokens?: number | null
          upstream_provider?: string | null
          user_id?: string | null
          validation_failures?: number | null
          validation_ms?: number | null
          work_unit?: string | null
        }
        Update: {
          brief_chars?: number | null
          cached_tokens?: number | null
          call_class?: string | null
          call_no?: number
          compacted?: boolean | null
          completed_at?: string | null
          completion_tokens?: number | null
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          files_read?: string[] | null
          files_written?: string[] | null
          finish_reason?: string | null
          first_token_at?: string | null
          history_chars?: number | null
          id?: string
          knowledge_chars?: number | null
          model?: string | null
          output_tps?: number | null
          progress?: boolean | null
          project_id?: string | null
          prompt_tokens?: number | null
          read_misses?: number | null
          recovery?: string | null
          request_started_at?: string | null
          system_chars?: number | null
          tool_calls?: string[] | null
          tool_errors?: number | null
          tool_ms?: number | null
          ttft_ms?: number | null
          turn_id?: string | null
          uncached_tokens?: number | null
          upstream_provider?: string | null
          user_id?: string | null
          validation_failures?: number | null
          validation_ms?: number | null
          work_unit?: string | null
        }
        Relationships: []
      }
      topup_lots: {
        Row: {
          created_at: string
          credits_granted: number
          credits_remaining: number
          environment: string
          expires_at: string | null
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
          expires_at?: string | null
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
          expires_at?: string | null
          id?: string
          pack_code?: string
          stripe_session_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      turn_economics: {
        Row: {
          agent_rounds: number
          ai_calls: number
          ai_cost_usd_micro: number | null
          browser_cost_usd_micro: number | null
          build_cost_usd_micro: number | null
          build_id: string | null
          build_ms: number | null
          cache_write_tokens: number
          cached_prompt_tokens: number
          completion_tokens: number
          cost_basis: string
          created_at: string
          credits_charged: number
          credits_estimated: number | null
          credits_refunded: number
          credits_reserved: number | null
          deploy_ms: number | null
          economics_cohort: string | null
          feature: string
          free_credits_charged: number
          id: string
          image_cost_usd_micro: number | null
          images_generated: number
          is_auto_fix: boolean
          metadata: Json
          models: Json
          operation_id: string | null
          operation_type: string | null
          other_cost_usd_micro: number | null
          paid_credits_charged: number
          project_id: string | null
          prompt_tokens: number
          providers: Json
          reasoning_tokens: number
          recovery_calls: number
          redundant_calls: number
          refund_reason: string | null
          result: string | null
          retry_calls: number
          retry_count: number
          revision: number | null
          session_id: string | null
          settlement_state: string
          turn_id: string
          updated_at: string
          user_id: string | null
          variable_cost_usd_micro: number | null
          verification_calls: number
          verify_ms: number | null
        }
        Insert: {
          agent_rounds?: number
          ai_calls?: number
          ai_cost_usd_micro?: number | null
          browser_cost_usd_micro?: number | null
          build_cost_usd_micro?: number | null
          build_id?: string | null
          build_ms?: number | null
          cache_write_tokens?: number
          cached_prompt_tokens?: number
          completion_tokens?: number
          cost_basis?: string
          created_at?: string
          credits_charged?: number
          credits_estimated?: number | null
          credits_refunded?: number
          credits_reserved?: number | null
          deploy_ms?: number | null
          economics_cohort?: string | null
          feature?: string
          free_credits_charged?: number
          id?: string
          image_cost_usd_micro?: number | null
          images_generated?: number
          is_auto_fix?: boolean
          metadata?: Json
          models?: Json
          operation_id?: string | null
          operation_type?: string | null
          other_cost_usd_micro?: number | null
          paid_credits_charged?: number
          project_id?: string | null
          prompt_tokens?: number
          providers?: Json
          reasoning_tokens?: number
          recovery_calls?: number
          redundant_calls?: number
          refund_reason?: string | null
          result?: string | null
          retry_calls?: number
          retry_count?: number
          revision?: number | null
          session_id?: string | null
          settlement_state?: string
          turn_id: string
          updated_at?: string
          user_id?: string | null
          variable_cost_usd_micro?: number | null
          verification_calls?: number
          verify_ms?: number | null
        }
        Update: {
          agent_rounds?: number
          ai_calls?: number
          ai_cost_usd_micro?: number | null
          browser_cost_usd_micro?: number | null
          build_cost_usd_micro?: number | null
          build_id?: string | null
          build_ms?: number | null
          cache_write_tokens?: number
          cached_prompt_tokens?: number
          completion_tokens?: number
          cost_basis?: string
          created_at?: string
          credits_charged?: number
          credits_estimated?: number | null
          credits_refunded?: number
          credits_reserved?: number | null
          deploy_ms?: number | null
          economics_cohort?: string | null
          feature?: string
          free_credits_charged?: number
          id?: string
          image_cost_usd_micro?: number | null
          images_generated?: number
          is_auto_fix?: boolean
          metadata?: Json
          models?: Json
          operation_id?: string | null
          operation_type?: string | null
          other_cost_usd_micro?: number | null
          paid_credits_charged?: number
          project_id?: string | null
          prompt_tokens?: number
          providers?: Json
          reasoning_tokens?: number
          recovery_calls?: number
          redundant_calls?: number
          refund_reason?: string | null
          result?: string | null
          retry_calls?: number
          retry_count?: number
          revision?: number | null
          session_id?: string | null
          settlement_state?: string
          turn_id?: string
          updated_at?: string
          user_id?: string | null
          variable_cost_usd_micro?: number | null
          verification_calls?: number
          verify_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "turn_economics_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "economic_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turn_economics_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
          base_revision: number | null
          committed_at: string | null
          committed_revision: number | null
          created_at: string
          credits_charged: number | null
          ended_at: string | null
          error_message: string | null
          heartbeat_at: string | null
          id: string
          last_progress_at: string | null
          last_seq: number
          pending_memory: Json | null
          progress_label: string | null
          project_id: string
          started_at: string
          status: string
          user_id: string
          worker_lease: string | null
        }
        Insert: {
          base_revision?: number | null
          committed_at?: string | null
          committed_revision?: number | null
          created_at?: string
          credits_charged?: number | null
          ended_at?: string | null
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          last_progress_at?: string | null
          last_seq?: number
          pending_memory?: Json | null
          progress_label?: string | null
          project_id: string
          started_at?: string
          status?: string
          user_id: string
          worker_lease?: string | null
        }
        Update: {
          base_revision?: number | null
          committed_at?: string | null
          committed_revision?: number | null
          created_at?: string
          credits_charged?: number | null
          ended_at?: string | null
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          last_progress_at?: string | null
          last_seq?: number
          pending_memory?: Json | null
          progress_label?: string | null
          project_id?: string
          started_at?: string
          status?: string
          user_id?: string
          worker_lease?: string | null
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
          credit_debt: number
          credits_reserved: number
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
          credit_debt?: number
          credits_reserved?: number
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
          credit_debt?: number
          credits_reserved?: number
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
      waitlist_announcements: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          cta_label: string | null
          cta_url: string | null
          failed_count: number
          heading: string | null
          id: string
          recipients_total: number
          sent_count: number
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_url?: string | null
          failed_count?: number
          heading?: string | null
          id?: string
          recipients_total?: number
          sent_count?: number
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          cta_label?: string | null
          cta_url?: string | null
          failed_count?: number
          heading?: string | null
          id?: string
          recipients_total?: number
          sent_count?: number
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      waitlist_referrals: {
        Row: {
          activated_at: string | null
          counted_at: string
          created_at: string
          id: string
          referred_credited_at: string | null
          referred_email: string
          referred_id: string
          referrer_credited_at: string | null
          referrer_id: string
          status: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          counted_at?: string
          created_at?: string
          id?: string
          referred_credited_at?: string | null
          referred_email: string
          referred_id: string
          referrer_credited_at?: string | null
          referrer_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          counted_at?: string
          created_at?: string
          id?: string
          referred_credited_at?: string | null
          referred_email?: string
          referred_id?: string
          referrer_credited_at?: string | null
          referrer_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_referrals_referred_id_fkey"
            columns: ["referred_id"]
            isOneToOne: true
            referencedRelation: "waitlist_signups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_referrals_referrer_id_fkey"
            columns: ["referrer_id"]
            isOneToOne: false
            referencedRelation: "waitlist_signups"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_signups: {
        Row: {
          approved_at: string | null
          created_at: string
          email: string
          first_signin_at: string | null
          id: string
          invited_at: string | null
          ip: unknown
          name: string
          notified_at: string | null
          referral_code: string | null
          referral_count: number
          referred_by: string | null
          source: string | null
          status_token: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          email: string
          first_signin_at?: string | null
          id?: string
          invited_at?: string | null
          ip?: unknown
          name: string
          notified_at?: string | null
          referral_code?: string | null
          referral_count?: number
          referred_by?: string | null
          source?: string | null
          status_token?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          email?: string
          first_signin_at?: string | null
          id?: string
          invited_at?: string | null
          ip?: unknown
          name?: string
          notified_at?: string | null
          referral_code?: string | null
          referral_count?: number
          referred_by?: string | null
          source?: string | null
          status_token?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_signups_referred_by_fkey"
            columns: ["referred_by"]
            isOneToOne: false
            referencedRelation: "waitlist_signups"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempts: number
          body: string
          created_at: string
          delivered_at: string | null
          event: string
          id: string
          last_error: string | null
          last_status: number | null
          next_retry_at: string
          status: string
          url: string
        }
        Insert: {
          attempts?: number
          body: string
          created_at?: string
          delivered_at?: string | null
          event?: string
          id?: string
          last_error?: string | null
          last_status?: number | null
          next_retry_at?: string
          status?: string
          url: string
        }
        Update: {
          attempts?: number
          body?: string
          created_at?: string
          delivered_at?: string | null
          event?: string
          id?: string
          last_error?: string | null
          last_status?: number | null
          next_retry_at?: string
          status?: string
          url?: string
        }
        Relationships: []
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
      ai_turn_economics_rollup: {
        Row: {
          ai_calls: number | null
          cached_input_tokens: number | null
          calls_without_usage: number | null
          cost_usd: number | null
          errors: number | null
          input_tokens: number | null
          output_tokens: number | null
          project_id: string | null
          retries: number | null
          started_at: string | null
          total_tokens: number | null
          turn_id: string | null
          user_id: string | null
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
      apply_paystack_marketplace_purchase: {
        Args: {
          _amount_minor: number
          _currency_code: string
          _listing_slug: string
          _reference: string
          _usd_amount_cents: number
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
          _custom_credits?: number
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
      available_credits: { Args: { _user_id: string }; Returns: number }
      billing_class_cost_p90: {
        Args: { _class: string; _min_samples?: number }
        Returns: number
      }
      billing_class_effort_p75: {
        Args: { _class: string }
        Returns: {
          p75: number
          samples: number
        }[]
      }
      build_billing_summary: { Args: { _days?: number }; Returns: Json }
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
      checkpoint_merge_pages: {
        Args: {
          _pages: Json
          _remaining: Json
          _stage: string
          _turn_id: string
        }
        Returns: boolean
      }
      claim_credit_paused_turn: {
        Args: { _checkpoint_id: string }
        Returns: {
          candidate_files: Json
          checkpoint_id: string
          project_id: string
          result_payload: Json
          turn_id: string
        }[]
      }
      claim_generation_turn: {
        Args: {
          p_project_id: string
          p_stale_seconds?: number
          p_turn_id: string
          p_user_id: string
        }
        Returns: {
          claimed: boolean
          turn_id: string
        }[]
      }
      claim_turn_heartbeat: {
        Args: { _lease: string; _turn_id: string }
        Returns: string
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
      economics_cohort_report: {
        Args: { _cohort_prefix?: string }
        Returns: Json
      }
      effort_economics_summary: { Args: { _days?: number }; Returns: Json }
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
      has_full_access: { Args: { _user_id: string }; Returns: boolean }
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
      is_build_credit_reason: { Args: { _reason: string }; Returns: boolean }
      is_paid_plan: { Args: { _user_id: string }; Returns: boolean }
      marketplace_admin_decide_payout: {
        Args: { p_decision: string; p_id: string; p_note?: string }
        Returns: undefined
      }
      marketplace_admin_list_payouts: {
        Args: { p_status?: string }
        Returns: {
          admin_note: string
          amount_cents: number
          creator_email: string
          creator_id: string
          decided_at: string
          destination: string
          id: string
          method: string
          paid_at: string
          requested_at: string
          status: string
        }[]
      }
      marketplace_admin_set_config: {
        Args: {
          p_commission_bps: number
          p_min_payout_cents: number
          p_payouts_enabled: boolean
        }
        Returns: undefined
      }
      marketplace_cancel_payout: { Args: { p_id: string }; Returns: undefined }
      marketplace_creator_summary: {
        Args: never
        Returns: {
          available_cents: number
          commission_cents: number
          gross_cents: number
          min_payout_cents: number
          net_cents: number
          paid_cents: number
          payouts_enabled: boolean
          requested_cents: number
          sales_count: number
        }[]
      }
      marketplace_get_live: {
        Args: { p_slug: string }
        Returns: {
          category: string
          cover_url: string
          creator_id: string
          currency_code: string
          demo_url: string
          description: string
          file_count: number
          id: string
          license_code: string
          open_count: number
          pitch: string
          price_minor: number
          published_at: string
          rating_avg: number
          rating_count: number
          sales_count: number
          screenshots: string[]
          slug: string
          title: string
        }[]
      }
      marketplace_is_enabled: { Args: never; Returns: boolean }
      marketplace_list_live: {
        Args: never
        Returns: {
          category: string
          cover_url: string
          creator_id: string
          currency_code: string
          demo_url: string
          file_count: number
          id: string
          license_code: string
          open_count: number
          pitch: string
          price_minor: number
          published_at: string
          rating_avg: number
          rating_count: number
          sales_count: number
          screenshots: string[]
          slug: string
          title: string
        }[]
      }
      marketplace_list_reviews: {
        Args: { p_slug: string }
        Returns: {
          body: string
          created_at: string
          id: string
          rating: number
          reviewer_avatar: string
          reviewer_name: string
        }[]
      }
      marketplace_open_listing: { Args: { p_slug: string }; Returns: string }
      marketplace_owns_listing: { Args: { p_slug: string }; Returns: boolean }
      marketplace_request_payout: {
        Args: { p_destination: string; p_method: string }
        Returns: string
      }
      marketplace_submit_review: {
        Args: { p_body?: string; p_rating: number; p_slug: string }
        Returns: string
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
      operation_credit_purpose: {
        Args: { _produced_revision: boolean; _type: string }
        Returns: string
      }
      operation_economics_report: { Args: { _since?: string }; Returns: Json }
      operation_for_turn_text: { Args: { _turn: string }; Returns: string }
      operation_transition_allowed: {
        Args: { _from: string; _to: string }
        Returns: boolean
      }
      project_screenshot_url: {
        Args: { p_project_id: string }
        Returns: string
      }
      public_project_build_get: {
        Args: { p_id: string }
        Returns: {
          created_at: string
          dist_path: string
          id: string
          project_id: string
          ready_at: string
          status: string
        }[]
      }
      public_project_get: {
        Args: { p_id?: string; p_slug?: string }
        Returns: {
          created_at: string
          hide_petal_badge: boolean
          id: string
          is_featured: boolean
          is_public: boolean
          latest_build_id: string
          owner_id: string
          primary_domain_id: string
          published_at: string
          published_build_id: string
          published_visibility: string
          remix_count: number
          remixed_from_id: string
          site_description: string
          site_icon_url: string
          site_og_image_url: string
          site_title: string
          slug: string
          subdomain: string
          summary: string
          title: string
          updated_at: string
        }[]
      }
      public_projects_list: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          hide_petal_badge: boolean
          id: string
          is_featured: boolean
          is_public: boolean
          latest_build_id: string
          owner_id: string
          primary_domain_id: string
          published_at: string
          published_build_id: string
          published_visibility: string
          remix_count: number
          remixed_from_id: string
          site_description: string
          site_icon_url: string
          site_og_image_url: string
          site_title: string
          slug: string
          subdomain: string
          summary: string
          title: string
          updated_at: string
        }[]
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
      reap_stalled_turns: { Args: never; Returns: undefined }
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
      refund_build_charge: {
        Args: { _build_id: string; _operation_id: string; _reason?: string }
        Returns: number
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
      release_build_reservation: {
        Args: { _reason?: string; _turn_id: string }
        Returns: number
      }
      replace_project_files: {
        Args: {
          _check_base?: boolean
          _files: Json
          _project_id: string
          _turn_id?: string
        }
        Returns: number
      }
      reserve_build_credits: {
        Args: {
          _class?: string
          _estimate: number
          _estimate_basis?: string
          _headroom: number
          _turn_id: string
          _user_id: string
        }
        Returns: {
          available: number
          idempotent: boolean
          ok: boolean
          reserved: number
        }[]
      }
      restore_free_build_credits: {
        Args: { _amount: number; _spent_at: string; _user_id: string }
        Returns: undefined
      }
      runtime_apply_monthly_grant: { Args: never; Returns: undefined }
      runtime_cap_check: {
        Args: { _amount_cents: number; _project_id: string; _user_id: string }
        Returns: {
          ok: boolean
          reason: string
        }[]
      }
      set_operation_type: {
        Args: { _turn_id: string; _type: string }
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
      settle_build_charge: {
        Args: {
          _amount: number
          _metadata?: Json
          _project_id?: string
          _reason?: string
          _turn_id?: string
          _user_id: string
        }
        Returns: {
          charged: number
          idempotent: boolean
          ledger_id: string
          shortfall: number
        }[]
      }
      spend_credit:
        | {
            Args: {
              _amount: number
              _metadata?: Json
              _operation_id?: string
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
      sync_builder_cron_secret: { Args: { _value: string }; Returns: undefined }
      waitlist_gen_code: { Args: never; Returns: string }
      waitlist_status: {
        Args: { _token: string }
        Returns: {
          approved: boolean
          created_at: string
          email: string
          name: string
          queue_position: number
          referral_code: string
          referral_count: number
          total: number
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
      app_role: ["admin", "user"],
    },
  },
} as const
