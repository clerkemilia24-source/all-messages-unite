export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type TableShape<Row, Insert = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Partial<Row>
  Relationships: []
}

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
      call_cohosts: TableShape<
        { call_id: string; user_id: string; assigned_at: string },
        { call_id: string; user_id: string; assigned_at?: string }
      >
      coin_accounts: TableShape<{
        id: string
        owner_id: string | null
        account_code: string | null
        account_type: string
        status: string
        created_at: string
      }>
      coin_entries: TableShape<{
        id: string
        transaction_id: string
        account_id: string
        amount_minor: number
        direction: string
        created_at: string
      }>
      coin_policy: TableShape<{
        id: boolean
        enabled: boolean
        transfer_fee_bps: number
        max_transfer_minor: number
        max_supply: number
        updated_at: string
      }>
      coin_supply: TableShape<{
        id: boolean
        total_minted: number
        total_burned: number
        updated_at: string
      }>
      coin_transactions: TableShape<{
        id: string
        initiator_id: string | null
        recipient_id: string | null
        transaction_type: string
        status: string
        amount_minor: number
        fee_minor: number
        idempotency_key: string
        reference_id: string | null
        metadata: Json
        created_at: string
      }>
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
      live_chat_messages: TableShape<{
        id: string
        stream_id: string
        sender_id: string
        body: string
        created_at: string
      }>
      live_streams: TableShape<{
        id: string
        host_id: string
        title: string
        room_name: string
        status: string
        chat_enabled: boolean
        created_at: string
        started_at: string | null
        ended_at: string | null
      }>
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
      push_device_tokens: TableShape<{
        id: string
        user_id: string
        installation_id: string
        token: string
        platform: string
        user_agent: string | null
        created_at: string
        last_seen_at: string
      }>
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
      social_follows: TableShape<
        { follower_id: string; following_id: string; created_at: string },
        { follower_id: string; following_id: string; created_at?: string }
      >
      social_posts: TableShape<
        {
          id: string
          author_id: string
          body: string | null
          media_path: string | null
          media_type: string | null
          visibility: string
          moderation_status: string
          repost_of: string | null
          created_at: string
        },
        {
          id?: string
          author_id: string
          body?: string | null
          media_path?: string | null
          media_type?: string | null
          visibility?: string
          moderation_status?: string
          repost_of?: string | null
          created_at?: string
        }
      >
      social_post_likes: TableShape<
        { post_id: string; user_id: string; created_at: string },
        { post_id: string; user_id: string; created_at?: string }
      >
      social_post_comments: TableShape<
        {
          id: string
          post_id: string
          author_id: string
          body: string
          moderation_status: string
          created_at: string
        },
        {
          id?: string
          post_id: string
          author_id: string
          body: string
          moderation_status?: string
          created_at?: string
        }
      >
      social_post_reports: TableShape<
        {
          id: string
          post_id: string
          reporter_id: string
          reason: string
          details: string | null
          created_at: string
        },
        {
          id?: string
          post_id: string
          reporter_id: string
          reason: string
          details?: string | null
          created_at?: string
        }
      >
      social_post_views: TableShape<
        { post_id: string; viewer_id: string; viewed_on: string },
        { post_id: string; viewer_id: string; viewed_on?: string }
      >
      social_post_saves: TableShape<
        { post_id: string; user_id: string; saved_at: string },
        { post_id: string; user_id: string; saved_at?: string }
      >
      shop_categories: TableShape<
        { id: string; name: string; slug: string; is_active: boolean; created_at: string },
        { id?: string; name: string; slug: string; is_active?: boolean; created_at?: string }
      >
      shop_cart_items: TableShape<{
        id: string
        buyer_id: string
        product_id: string
        quantity: number
        created_at: string
        updated_at: string
      }>
      shop_checkout_events: TableShape<{
        provider: string
        event_id: string
        event_type: string
        order_id: string | null
        processing_status: string
        received_at: string
        processed_at: string | null
      }>
      shop_order_items: TableShape<{
        id: string
        order_id: string
        product_id: string
        title_snapshot: string
        quantity: number
        unit_price_minor: number
        currency: string
        created_at: string
      }>
      shop_orders: TableShape<{
        id: string
        buyer_id: string
        seller_id: string
        status: string
        payment_source: string
        wallet_transaction_id: string | null
        currency: string
        subtotal_minor: number
        total_minor: number
        idempotency_key: string
        stripe_session_id: string | null
        reservation_expires_at: string
        shipping_address: Json
        tracking_carrier: string | null
        tracking_number: string | null
        created_at: string
        paid_at: string | null
        shipped_at: string | null
        delivered_at: string | null
        updated_at: string
      }>
      shop_products: TableShape<
        {
          id: string
          seller_id: string
          category_id: string
          title: string
          description: string | null
          price_minor: number
          currency: string
          inventory_count: number
          condition: string
          moderation_status: string
          created_at: string
          updated_at: string
        },
        {
          id?: string
          seller_id: string
          category_id: string
          title: string
          description?: string | null
          price_minor: number
          currency?: string
          inventory_count?: number
          condition?: string
          moderation_status?: string
          created_at?: string
          updated_at?: string
        }
      >
      status_reactions: TableShape<
        { status_id: string; user_id: string; emoji: string; created_at: string },
        { status_id: string; user_id: string; emoji: string; created_at?: string }
      >
      status_replies: TableShape<
        {
          id: string
          status_id: string
          sender_id: string
          body: string
          created_at: string
        },
        {
          id?: string
          status_id: string
          sender_id: string
          body: string
          created_at?: string
        }
      >
      status_posts: {
        Row: {
          author_id: string
          background: string | null
          body: string | null
          created_at: string
          expires_at: string
          id: string
          kind: string
          media_type: string | null
          media_url: string | null
        }
        Insert: {
          author_id: string
          background?: string | null
          body?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind: string
          media_type?: string | null
          media_url?: string | null
        }
        Update: {
          author_id?: string
          background?: string | null
          body?: string | null
          created_at?: string
          expires_at?: string
          id?: string
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
      wallet_accounts: TableShape<{
        id: string
        owner_id: string | null
        account_code: string | null
        account_type: string
        currency: string
        status: string
        created_at: string
      }>
      wallet_entries: TableShape<{
        id: string
        transaction_id: string
        account_id: string
        amount_minor: number
        direction: string
        bucket: string
        created_at: string
      }>
      wallet_limits: TableShape<{
        currency: string
        enabled: boolean
        max_transfer_minor: number
        daily_transfer_minor: number
        max_funding_minor: number
        updated_at: string
      }>
      wallet_payment_methods: TableShape<{
        id: string
        user_id: string
        provider: string
        provider_method_id: string
        method_type: string
        brand: string | null
        last_four: string | null
        is_default: boolean
        status: string
        created_at: string
      }>
      wallet_payment_requests: TableShape<{
        id: string
        requester_id: string
        payer_id: string | null
        amount_minor: number
        currency: string
        note: string | null
        status: string
        idempotency_key: string
        settled_transaction_id: string | null
        expires_at: string
        created_at: string
      }>
      wallet_provider_events: TableShape<{
        provider: string
        event_id: string
        event_type: string
        transaction_id: string | null
        processing_status: string
        received_at: string
        processed_at: string | null
        error_code: string | null
      }>
      wallet_transactions: TableShape<{
        id: string
        sender_id: string
        recipient_id: string | null
        transaction_type: string
        status: string
        currency: string
        amount_minor: number
        idempotency_key: string
        provider: string | null
        provider_reference: string | null
        reverses_transaction_id: string | null
        metadata: Json
        created_at: string
        settled_at: string | null
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
      ensure_coin_account: { Args: Record<string, never>; Returns: string }
      get_coin_balance: {
        Args: Record<string, never>
        Returns: { available_minor: number; total_minted: number; total_burned: number }[]
      }
      transfer_coin: {
        Args: {
          _recipient_id: string
          _amount_minor: number
          _idempotency_key: string
          _transaction_type?: string
          _reference_id?: string | null
        }
        Returns: { transaction_id: string; status: string }[]
      }
      issue_coin: {
        Args: { _recipient_id: string; _amount_minor: number; _idempotency_key: string }
        Returns: string
      }
      burn_coin: {
        Args: { _amount_minor: number; _idempotency_key: string }
        Returns: string
      }
      is_member: {
        Args: { _conversation_id: string; _user_id: string }
        Returns: boolean
      }
      set_call_cohost: {
        Args: { _call_id: string; _user_id: string; _is_cohost: boolean }
        Returns: undefined
      }
      record_social_post_view: {
        Args: { _post_id: string }
        Returns: boolean
      }
      get_social_post_view_counts: {
        Args: { _post_ids: string[] }
        Returns: { post_id: string; view_count: number }[]
      }
      ensure_wallet_account: {
        Args: { _currency: string }
        Returns: string
      }
      get_wallet_balances: {
        Args: { _currency: string }
        Returns: { available_minor: number; pending_minor: number }[]
      }
      create_wallet_payment_request: {
        Args: {
          _payer_id: string | null
          _amount_minor: number
          _currency: string
          _note: string | null
          _idempotency_key: string
        }
        Returns: string
      }
      pay_wallet_payment_request: {
        Args: { _request_id: string; _idempotency_key: string }
        Returns: { request_id: string; transaction_id: string; status: string }[]
      }
      cancel_wallet_payment_request: {
        Args: { _request_id: string }
        Returns: boolean
      }
      expire_wallet_payment_requests: {
        Args: Record<string, never>
        Returns: number
      }
      send_wallet_transfer: {
        Args: {
          _recipient_id: string
          _amount_minor: number
          _currency: string
          _idempotency_key: string
        }
        Returns: { transaction_id: string; status: string }[]
      }
      begin_wallet_funding: {
        Args: { _amount_minor: number; _currency: string; _idempotency_key: string }
        Returns: { transaction_id: string; status: string }[]
      }
      attach_wallet_funding_session: {
        Args: { _transaction_id: string; _session_id: string }
        Returns: boolean
      }
      settle_wallet_funding: {
        Args: {
          _event_id: string
          _event_type: string
          _transaction_id: string
          _session_id: string
          _amount_minor: number
          _currency: string
        }
        Returns: boolean
      }
      fail_wallet_funding: {
        Args: {
          _event_id: string
          _event_type: string
          _transaction_id: string
          _session_id: string
        }
        Returns: boolean
      }
      set_live_stream_status: {
        Args: { _stream_id: string; _next_status: string }
        Returns: boolean
      }
      set_shop_cart_item: {
        Args: { _product_id: string; _quantity: number }
        Returns: string
      }
      remove_shop_cart_item: {
        Args: { _product_id: string }
        Returns: boolean
      }
      release_expired_shop_reservations: {
        Args: Record<string, never>
        Returns: number
      }
      create_shop_order_from_cart: {
        Args: { _idempotency_key: string; _shipping_address: Json }
        Returns: {
          order_id: string
          status: string
          total_minor: number
          reservation_expires_at: string
        }[]
      }
      create_shop_order_with_wallet: {
        Args: { _idempotency_key: string; _shipping_address: Json }
        Returns: {
          order_id: string
          wallet_transaction_id: string
          status: string
          total_minor: number
        }[]
      }
      pay_shop_order_with_wallet: {
        Args: { _order_id: string; _idempotency_key: string }
        Returns: { order_id: string; wallet_transaction_id: string; status: string }[]
      }
      confirm_shop_order_delivery: {
        Args: { _order_id: string; _idempotency_key: string }
        Returns: { order_id: string; status: string; earning_transaction_id: string | null }[]
      }
      refund_wallet_shop_order: {
        Args: { _order_id: string; _idempotency_key: string }
        Returns: { order_id: string; status: string; refund_transaction_id: string }[]
      }
      attach_shop_checkout_session: {
        Args: { _order_id: string; _session_id: string }
        Returns: boolean
      }
      settle_shop_order: {
        Args: {
          _event_id: string
          _event_type: string
          _order_id: string
          _session_id: string
          _amount_minor: number
          _currency: string
        }
        Returns: boolean
      }
      fail_shop_order: {
        Args: { _event_id: string; _event_type: string; _order_id: string; _session_id: string }
        Returns: boolean
      }
      update_shop_order_fulfillment: {
        Args: {
          _order_id: string
          _next_status: string
          _tracking_carrier: string | null
          _tracking_number: string | null
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
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
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
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
