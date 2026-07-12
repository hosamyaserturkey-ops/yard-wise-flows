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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: Database["public"]["Enums"]["activity_action"]
          container_id: string | null
          container_number: string | null
          created_at: string
          id: string
          metadata: Json
          occurred_at: string
          shift: Database["public"]["Enums"]["work_shift"]
          user_id: string
          yard_id: string
        }
        Insert: {
          action: Database["public"]["Enums"]["activity_action"]
          container_id?: string | null
          container_number?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          shift: Database["public"]["Enums"]["work_shift"]
          user_id: string
          yard_id: string
        }
        Update: {
          action?: Database["public"]["Enums"]["activity_action"]
          container_id?: string | null
          container_number?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          occurred_at?: string
          shift?: Database["public"]["Enums"]["work_shift"]
          user_id?: string
          yard_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_yard_id_fkey"
            columns: ["yard_id"]
            isOneToOne: false
            referencedRelation: "yards"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booking_number: string
          created_at: string
          created_by: string
          customer_name: string
          gated_out_containers: number
          id: string
          status: string
          total_containers: number
          updated_at: string
          yard_id: string
        }
        Insert: {
          booking_number: string
          created_at?: string
          created_by: string
          customer_name: string
          gated_out_containers?: number
          id?: string
          status?: string
          total_containers: number
          updated_at?: string
          yard_id: string
        }
        Update: {
          booking_number?: string
          created_at?: string
          created_by?: string
          customer_name?: string
          gated_out_containers?: number
          id?: string
          status?: string
          total_containers?: number
          updated_at?: string
          yard_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_yard_id_fkey"
            columns: ["yard_id"]
            isOneToOne: false
            referencedRelation: "yards"
            referencedColumns: ["id"]
          },
        ]
      }
      container_port_data: {
        Row: {
          container_number: string
          created_at: string
          daily_demurrage: number
          free_days: number
          id: string
          last_source: string
          port_arrival_date: string
          shipping_line: string
          updated_at: string
          yard_id: string
        }
        Insert: {
          container_number: string
          created_at?: string
          daily_demurrage: number
          free_days: number
          id?: string
          last_source?: string
          port_arrival_date: string
          shipping_line: string
          updated_at?: string
          yard_id: string
        }
        Update: {
          container_number?: string
          created_at?: string
          daily_demurrage?: number
          free_days?: number
          id?: string
          last_source?: string
          port_arrival_date?: string
          shipping_line?: string
          updated_at?: string
          yard_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "container_port_data_yard_id_fkey"
            columns: ["yard_id"]
            isOneToOne: false
            referencedRelation: "yards"
            referencedColumns: ["id"]
          },
        ]
      }
      containers: {
        Row: {
          booking_id: string | null
          booking_number: string | null
          container_number: string
          container_type: string
          created_at: string
          created_by: string
          daily_demurrage: number | null
          driver_name: string
          fees: number | null
          free_days: number | null
          gate_in_time: string
          gate_out_time: string | null
          id: string
          port_arrival_date: string | null
          shipping_line: string
          status: Database["public"]["Enums"]["container_status"]
          truck_number: string
          updated_at: string
          yard_block: string | null
          yard_id: string
          yard_row: string | null
        }
        Insert: {
          booking_id?: string | null
          booking_number?: string | null
          container_number: string
          container_type: string
          created_at?: string
          created_by: string
          daily_demurrage?: number | null
          driver_name: string
          fees?: number | null
          free_days?: number | null
          gate_in_time?: string
          gate_out_time?: string | null
          id?: string
          port_arrival_date?: string | null
          shipping_line: string
          status?: Database["public"]["Enums"]["container_status"]
          truck_number: string
          updated_at?: string
          yard_block?: string | null
          yard_id: string
          yard_row?: string | null
        }
        Update: {
          booking_id?: string | null
          booking_number?: string | null
          container_number?: string
          container_type?: string
          created_at?: string
          created_by?: string
          daily_demurrage?: number | null
          driver_name?: string
          fees?: number | null
          free_days?: number | null
          gate_in_time?: string
          gate_out_time?: string | null
          id?: string
          port_arrival_date?: string | null
          shipping_line?: string
          status?: Database["public"]["Enums"]["container_status"]
          truck_number?: string
          updated_at?: string
          yard_block?: string | null
          yard_id?: string
          yard_row?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "containers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "containers_yard_id_fkey"
            columns: ["yard_id"]
            isOneToOne: false
            referencedRelation: "yards"
            referencedColumns: ["id"]
          },
        ]
      }
      demurrage_payments: {
        Row: {
          chargeable_days: number
          collected_by: string
          container_number: string
          created_at: string
          demurrage_amount: number
          handling_fee: number
          id: string
          payment_method: string
          service_fee: number
          shipping_line: string
          shipping_line_share: number
          total_collected: number
          transferred: boolean
          yard_id: string
          yard_share: number
        }
        Insert: {
          chargeable_days: number
          collected_by: string
          container_number: string
          created_at?: string
          demurrage_amount: number
          handling_fee?: number
          id?: string
          payment_method?: string
          service_fee?: number
          shipping_line: string
          shipping_line_share?: number
          total_collected: number
          transferred?: boolean
          yard_id: string
          yard_share?: number
        }
        Update: {
          chargeable_days?: number
          collected_by?: string
          container_number?: string
          created_at?: string
          demurrage_amount?: number
          handling_fee?: number
          id?: string
          payment_method?: string
          service_fee?: number
          shipping_line?: string
          shipping_line_share?: number
          total_collected?: number
          transferred?: boolean
          yard_id?: string
          yard_share?: number
        }
        Relationships: [
          {
            foreignKeyName: "demurrage_payments_yard_id_fkey"
            columns: ["yard_id"]
            isOneToOne: false
            referencedRelation: "yards"
            referencedColumns: ["id"]
          },
        ]
      }
      edi_transmissions: {
        Row: {
          ack_received_at: string | null
          carrier: string
          container_number: string
          created_at: string | null
          edi_content: string | null
          error_message: string | null
          filename: string | null
          id: string
          sent_at: string | null
          status: string | null
          transaction_type: string
          yard_id: string
        }
        Insert: {
          ack_received_at?: string | null
          carrier: string
          container_number: string
          created_at?: string | null
          edi_content?: string | null
          error_message?: string | null
          filename?: string | null
          id?: string
          sent_at?: string | null
          status?: string | null
          transaction_type: string
          yard_id: string
        }
        Update: {
          ack_received_at?: string | null
          carrier?: string
          container_number?: string
          created_at?: string | null
          edi_content?: string | null
          error_message?: string | null
          filename?: string | null
          id?: string
          sent_at?: string | null
          status?: string | null
          transaction_type?: string
          yard_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edi_transmissions_yard_id_fkey"
            columns: ["yard_id"]
            isOneToOne: false
            referencedRelation: "yards"
            referencedColumns: ["id"]
          },
        ]
      }
      inspector_checks: {
        Row: {
          container_number: string
          created_at: string
          grade: string
          id: string
          inspector_id: string
          notes: string | null
          photo_urls: Json | null
          status: string
          updated_at: string
          yard_id: string
        }
        Insert: {
          container_number: string
          created_at?: string
          grade: string
          id?: string
          inspector_id: string
          notes?: string | null
          photo_urls?: Json | null
          status?: string
          updated_at?: string
          yard_id: string
        }
        Update: {
          container_number?: string
          created_at?: string
          grade?: string
          id?: string
          inspector_id?: string
          notes?: string | null
          photo_urls?: Json | null
          status?: string
          updated_at?: string
          yard_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspector_checks_yard_id_fkey"
            columns: ["yard_id"]
            isOneToOne: false
            referencedRelation: "yards"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
          username: string | null
          yard_id: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
          username?: string | null
          yard_id?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
          username?: string | null
          yard_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_yard_id_fkey"
            columns: ["yard_id"]
            isOneToOne: false
            referencedRelation: "yards"
            referencedColumns: ["id"]
          },
        ]
      }
      shipping_line_transfers: {
        Row: {
          amount_transferred: number
          created_at: string
          id: string
          receipt_url: string | null
          shipping_line: string
          transferred_at: string
          transferred_by: string
          yard_id: string
        }
        Insert: {
          amount_transferred: number
          created_at?: string
          id?: string
          receipt_url?: string | null
          shipping_line: string
          transferred_at?: string
          transferred_by: string
          yard_id: string
        }
        Update: {
          amount_transferred?: number
          created_at?: string
          id?: string
          receipt_url?: string | null
          shipping_line?: string
          transferred_at?: string
          transferred_by?: string
          yard_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipping_line_transfers_yard_id_fkey"
            columns: ["yard_id"]
            isOneToOne: false
            referencedRelation: "yards"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      yards: {
        Row: {
          code: string
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          created_by: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      container_demurrage: {
        Row: {
          chargeable_days: number | null
          container_number: string | null
          daily_demurrage: number | null
          days_from_arrival: number | null
          demurrage_amount: number | null
          free_days: number | null
          port_arrival_date: string | null
          shipping_line: string | null
        }
        Insert: {
          chargeable_days?: never
          container_number?: string | null
          daily_demurrage?: number | null
          days_from_arrival?: never
          demurrage_amount?: never
          free_days?: number | null
          port_arrival_date?: string | null
          shipping_line?: string | null
        }
        Update: {
          chargeable_days?: never
          container_number?: string | null
          daily_demurrage?: number | null
          days_from_arrival?: never
          demurrage_amount?: never
          free_days?: number | null
          port_arrival_date?: string | null
          shipping_line?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      current_yard_id: { Args: never; Returns: string }
      get_user_role: {
        Args: { user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_gated_out_containers: {
        Args: { booking_num: string }
        Returns: undefined
      }
      is_super_admin: { Args: { _uid: string }; Returns: boolean }
      is_yard_admin: { Args: { _uid: string; _yard: string }; Returns: boolean }
    }
    Enums: {
      activity_action:
        | "gate_in"
        | "gate_out"
        | "reserve"
        | "unreserve"
        | "demurrage_collected"
      app_role: "admin" | "user" | "super_admin" | "inspector"
      container_status: "in-yard" | "out" | "reserved"
      work_shift: "day" | "night"
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
      activity_action: [
        "gate_in",
        "gate_out",
        "reserve",
        "unreserve",
        "demurrage_collected",
      ],
      app_role: ["admin", "user", "super_admin", "inspector"],
      container_status: ["in-yard", "out", "reserved"],
      work_shift: ["day", "night"],
    },
  },
} as const
