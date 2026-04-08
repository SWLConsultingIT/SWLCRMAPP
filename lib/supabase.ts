import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseKey)

export type Lead = {
  id: string
  first_name: string
  last_name: string
  email: string
  company: string
  role: string
  linkedin_url: string
  status: string
  assigned_seller: string
  seller_id: string
  allow_linkedin: boolean
  allow_email: boolean
  allow_whatsapp: boolean
  allow_call: boolean
  n8n_flow: string
  created_at: string
  updated_at: string
  odoo_lead_id: number | null
}

export type Campaign = {
  id: string
  lead_id: string
  seller_id: string
  channel: string
  status: string
  current_step: number
  sequence_steps: string[]
  channel_msg_index: Record<string, number>
  last_step_at: string | null
  paused_until: string | null
  completed_at: string | null
  created_at: string
  leads?: Lead
  sellers?: Seller
}

export type Seller = {
  id: string
  name: string
  email: string
  linkedin_daily_limit: number
  linkedin_connections_limit: number
  email_daily_limit: number
  whatsapp_daily_limit: number
  call_daily_limit: number
  unipile_account_id: string
}

export type CampaignMessage = {
  id: string
  campaign_id: string
  message_number: number
  channel: string
  content: string
  sent_at: string | null
  created_at: string
}

export type LeadReply = {
  id: string
  lead_id: string
  campaign_id: string
  message: string
  classification: string
  received_at: string
  created_at: string
}
