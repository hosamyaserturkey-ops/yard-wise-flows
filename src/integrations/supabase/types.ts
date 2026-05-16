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
        }
        Relationships: []
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
        }
        Relationships: []
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
        }
        Relationships: [
          {
            foreignKeyName: "containers_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
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
          yard_share?: number
        }
        Relationships: []
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
        }
        Relationships: []
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
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
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
        }
        Insert: {
          amount_transferred: number
          created_at?: string
          id?: string
          receipt_url?: string | null
          shipping_line: string
          transferred_at?: string
          transferred_by: string
        }
        Update: {
          amount_transferred?: number
          created_at?: string
          id?: string
          receipt_url?: string | null
          shipping_line?: string
          transferred_at?: string
          transferred_by?: string
        }
        Relationships: []
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
    }
    Enums: {
      app_role: "admin" | "user" | "super_admin"
      container_status: "in-yard" | "out" | "reserved"
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
      app_role: ["admin", "user", "super_admin"],
      container_status: ["in-yard", "out", "reserved"],
    },
  },
} as const
