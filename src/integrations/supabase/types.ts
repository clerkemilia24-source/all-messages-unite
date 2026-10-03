export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type FeatureTable<Row> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

type FunctionSignature<Args, Returns> = {
  Args: Args
  Returns: Returns
}

type RpcArguments = Record<string, Json | undefined>

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      call_sessions: {
        Row: {
          answered_at: string | null
          conversation_id: string
          created_at: string
          ended_at: string | null
          id: string
          initiator_id: string
          kind: string
          room_name: string
          status: string
        }
        Insert: {
          answered_at?: string | null
          conversation_id: string
          created_at?: string
          ended_at?: string | null
          id?: string
          initiator_id: string
          kind: string
          room_name: string
          status?: string
        }
        Update: {
          answered_at?: string | null
          conversation_id?: string
          created_at?: string
          ended_at?: string | null
          id?: string
          initiator_id?: string
          kind?: string
          room_name?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_sessions_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_members: {
        Row: {
          conversation_id: string
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          joined_at?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          is_group: boolean
          last_message_at: string
          name: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          is_group?: boolean
          last_message_at?: string
          name?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          is_group?: boolean
          last_message_at?: string
          name?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          attachment_name: string | null
          attachment_size: number | null
          attachment_type: string | null
          attachment_url: string | null
          body: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          effect: string | null
          id: string
          media_duration: number | null
          media_kind: string | null
          reply_to: string | null
          sender_id: string
        }
        Insert: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          body?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          effect?: string | null
          id?: string
          media_duration?: number | null
          media_kind?: string | null
          reply_to?: string | null
          sender_id: string
        }
        Update: {
          attachment_name?: string | null
          attachment_size?: number | null
          attachment_type?: string | null
          attachment_url?: string | null
          body?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          effect?: string | null
          id?: string
          media_duration?: number | null
          media_kind?: string | null
          reply_to?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_fkey"
            columns: ["reply_to"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          last_seen: string
          last_seen_visible: boolean
          photo_visible: boolean
          read_receipts: boolean
          status_text: string | null
          status_visible: boolean
          username: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          last_seen?: string
          last_seen_visible?: boolean
          photo_visible?: boolean
          read_receipts?: boolean
          status_text?: string | null
          status_visible?: boolean
          username: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          last_seen?: string
          last_seen_visible?: boolean
          photo_visible?: boolean
          read_receipts?: boolean
          status_text?: string | null
          status_visible?: boolean
          username?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          created_at: string
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      status_posts: {
        Row: {
          audience_ids: string[]
          audience_mode: string
          author_id: string
          background: string | null
          body: string | null
          created_at: string
          expires_at: string
          id: string
          is_highlighted: boolean
          kind: string
          media_type: string | null
          media_url: string | null
        }
        Insert: {
          audience_ids?: string[]
          audience_mode?: string
          author_id: string
          background?: string | null
          body?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          is_highlighted?: boolean
          kind: string
          media_type?: string | null
          media_url?: string | null
        }
        Update: {
          audience_ids?: string[]
          audience_mode?: string
          author_id?: string
          background?: string | null
          body?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          is_highlighted?: boolean
          kind?: string
          media_type?: string | null
          media_url?: string | null
        }
        Relationships: []
      }
      status_views: {
        Row: {
          status_id: string
          viewed_at: string
          viewer_id: string
        }
        Insert: {
          status_id: string
          viewed_at?: string
          viewer_id: string
        }
        Update: {
          status_id?: string
          viewed_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_views_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "status_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      typing_status: {
        Row: {
          conversation_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "typing_status_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_cohosts: FeatureTable<{
        assigned_at: string
        call_id: string
        user_id: string
      }>
      status_reactions: FeatureTable<{
        created_at: string
        emoji: string
        status_id: string
        user_id: string
      }>
      status_replies: FeatureTable<{
        body: string
        created_at: string
        id: string
        sender_id: string
        status_id: string
      }>
      status_mutes: FeatureTable<{
        created_at: string
        muted_user_id: string
        user_id: string
      }>
      status_highlights: FeatureTable<{
        saved_at: string
        status_id: string
        user_id: string
      }>
      social_follows: FeatureTable<{
        created_at: string
        follower_id: string
        following_id: string
      }>
      social_posts: FeatureTable<{
        author_id: string
        body: string | null
        created_at: string
        id: string
        media_path: string | null
        media_type: string | null
        moderation_status: string
        repost_of: string | null
        visibility: string
      }>
      social_post_likes: FeatureTable<{
        created_at: string
        post_id: string
        user_id: string
      }>
      social_post_comments: FeatureTable<{
        author_id: string
        body: string
        created_at: string
        id: string
        moderation_status: string
        post_id: string
      }>
      social_post_reports: FeatureTable<{
        created_at: string
        details: string | null
        id: string
        post_id: string
        reason: string
        reporter_id: string
      }>
      social_post_views: FeatureTable<{
        post_id: string
        viewed_on: string
        viewer_id: string
      }>
      social_post_saves: FeatureTable<{
        post_id: string
        saved_at: string
        user_id: string
      }>
      shop_categories: FeatureTable<{
        created_at: string
        id: string
        is_active: boolean
        name: string
        slug: string
      }>
      shop_products: FeatureTable<{
        category_id: string
        condition: string
        created_at: string
        currency: string
        description: string | null
        id: string
        inventory_count: number
        moderation_status: string
        price_minor: number
        seller_id: string
        title: string
        updated_at: string
      }>
      shop_cart_items: FeatureTable<{
        buyer_id: string
        created_at: string
        id: string
        product_id: string
        quantity: number
        updated_at: string
      }>
      shop_orders: FeatureTable<{
        buyer_id: string
        created_at: string
        currency: string
        delivered_at: string | null
        id: string
        idempotency_key: string
        paid_at: string | null
        payment_source: string
        reservation_expires_at: string
        seller_id: string
        shipped_at: string | null
        shipping_address: Json
        status: string
        stripe_session_id: string | null
        subtotal_minor: number
        total_minor: number
        tracking_carrier: string | null
        tracking_number: string | null
        updated_at: string
        wallet_transaction_id: string | null
      }>
      shop_order_items: FeatureTable<{
        created_at: string
        currency: string
        id: string
        order_id: string
        product_id: string
        quantity: number
        title_snapshot: string
        unit_price_minor: number
      }>
      shop_checkout_events: FeatureTable<{
        event_id: string
        event_type: string
        order_id: string | null
        processed_at: string | null
        processing_status: string
        provider: string
        received_at: string
      }>
      live_streams: FeatureTable<{
        chat_enabled: boolean
        created_at: string
        ended_at: string | null
        host_id: string
        id: string
        room_name: string
        started_at: string | null
        status: string
        title: string
      }>
      live_chat_messages: FeatureTable<{
        body: string
        created_at: string
        id: string
        sender_id: string
        stream_id: string
      }>
      push_device_tokens: FeatureTable<{
        created_at: string
        id: string
        installation_id: string
        last_seen_at: string
        platform: string
        token: string
        user_agent: string | null
        user_id: string
      }>
      wallet_limits: FeatureTable<{
        currency: string
        daily_transfer_minor: number
        enabled: boolean
        max_funding_minor: number
        max_transfer_minor: number
        updated_at: string
      }>
      wallet_accounts: FeatureTable<{
        account_code: string | null
        account_type: string
        created_at: string
        currency: string
        id: string
        owner_id: string | null
        status: string
      }>
      wallet_transactions: FeatureTable<{
        amount_minor: number
        created_at: string
        currency: string
        id: string
        idempotency_key: string
        metadata: Json
        provider: string | null
        provider_reference: string | null
        recipient_id: string | null
        reverses_transaction_id: string | null
        sender_id: string
        settled_at: string | null
        status: string
        transaction_type: string
      }>
      wallet_entries: FeatureTable<{
        account_id: string
        amount_minor: number
        bucket: string
        created_at: string
        direction: string
        id: string
        transaction_id: string
      }>
      wallet_provider_events: FeatureTable<{
        error_code: string | null
        event_id: string
        event_type: string
        processed_at: string | null
        processing_status: string
        provider: string
        received_at: string
        transaction_id: string | null
      }>
      wallet_payment_methods: FeatureTable<{
        brand: string | null
        created_at: string
        id: string
        is_default: boolean
        last_four: string | null
        method_type: string
        provider: string
        provider_method_id: string
        status: string
        user_id: string
      }>
      wallet_payment_requests: FeatureTable<{
        amount_minor: number
        created_at: string
        currency: string
        expires_at: string
        id: string
        idempotency_key: string
        note: string | null
        payer_id: string | null
        requester_id: string
        settled_transaction_id: string | null
        status: string
      }>
      coin_policy: FeatureTable<{
        enabled: boolean
        id: boolean
        max_supply: number
        max_transfer_minor: number
        transfer_fee_bps: number
        updated_at: string
      }>
      coin_supply: FeatureTable<{
        id: boolean
        total_burned: number
        total_minted: number
        updated_at: string
      }>
      coin_accounts: FeatureTable<{
        account_code: string | null
        account_type: string
        created_at: string
        id: string
        owner_id: string | null
        status: string
      }>
      coin_transactions: FeatureTable<{
        amount_minor: number
        created_at: string
        fee_minor: number
        id: string
        idempotency_key: string
        initiator_id: string | null
        metadata: Json
        recipient_id: string | null
        reference_id: string | null
        status: string
        transaction_type: string
      }>
      coin_entries: FeatureTable<{
        account_id: string
        amount_minor: number
        created_at: string
        direction: string
        id: string
        transaction_id: string
      }>
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_chat: {
        Args: { _is_group: boolean; _name: string; _other_ids: string[] }
        Returns: string
      }
      is_member: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      set_call_cohost: FunctionSignature<RpcArguments, undefined>
      record_social_post_view: FunctionSignature<RpcArguments, boolean>
      get_social_post_view_counts: FunctionSignature<
        { _post_ids: string[] },
        { post_id: string; view_count: number }[]
      >
      set_live_stream_status: FunctionSignature<RpcArguments, boolean>
      ensure_wallet_account: FunctionSignature<RpcArguments, string>
      get_wallet_balances: FunctionSignature<
        RpcArguments,
        { available_minor: number; pending_minor: number }[]
      >
      send_wallet_transfer: FunctionSignature<
        RpcArguments,
        { transaction_id: string; status: string }[]
      >
      begin_wallet_funding: FunctionSignature<
        RpcArguments,
        { transaction_id: string; status: string; amount_minor: number; currency: string }[]
      >
      attach_wallet_funding_session: FunctionSignature<RpcArguments, boolean>
      settle_wallet_funding: FunctionSignature<RpcArguments, boolean>
      fail_wallet_funding: FunctionSignature<RpcArguments, boolean>
      create_wallet_payment_request: FunctionSignature<RpcArguments, string>
      pay_wallet_payment_request: FunctionSignature<
        RpcArguments,
        { request_id: string; transaction_id: string; status: string }[]
      >
      cancel_wallet_payment_request: FunctionSignature<RpcArguments, boolean>
      expire_wallet_payment_requests: FunctionSignature<RpcArguments, number>
      ensure_coin_account: FunctionSignature<never, string>
      get_coin_balance: FunctionSignature<
        never,
        { available_minor: number; total_minted: number; total_burned: number }[]
      >
      transfer_coin: FunctionSignature<
        RpcArguments,
        { transaction_id: string; status: string }[]
      >
      set_shop_cart_item: FunctionSignature<RpcArguments, string>
      remove_shop_cart_item: FunctionSignature<RpcArguments, boolean>
      create_shop_order_from_cart: FunctionSignature<
        RpcArguments,
        { order_id: string; status: string; total_minor: number; reservation_expires_at: string }[]
      >
      attach_shop_checkout_session: FunctionSignature<RpcArguments, boolean>
      settle_shop_order: FunctionSignature<RpcArguments, boolean>
      fail_shop_order: FunctionSignature<RpcArguments, boolean>
      create_shop_order_with_wallet: FunctionSignature<
        RpcArguments,
        { order_id: string; wallet_transaction_id: string; status: string }[]
      >
      update_shop_order_fulfillment: FunctionSignature<RpcArguments, boolean>
      confirm_shop_order_delivery: FunctionSignature<
        RpcArguments,
        { order_id: string; wallet_transaction_id: string; status: string }[]
      >
      refund_wallet_shop_order: FunctionSignature<
        RpcArguments,
        { order_id: string; wallet_transaction_id: string; status: string }[]
      >
      release_expired_shop_reservations: FunctionSignature<never, number>
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
    Enums: {},
  },
} as const
