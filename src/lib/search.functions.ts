import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';

export const searchMessages = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ query: z.string().trim().min(1).max(200), page: z.number().int().min(0).max(10000) }).parse(input))
  .handler(async ({ data, context }) => {
    const pattern = `%${data.query.replace(/[\\%_]/g, '\\$&')}%`;
    const result = await context.supabase.from('messages')
      .select('id, conversation_id, body, created_at')
      .is('deleted_at', null).ilike('body', pattern)
      .order('created_at', { ascending: false }).order('id')
      .range(data.page * 30, data.page * 30 + 30);
    if (result.error) throw new Error('Search could not be completed. Please try again.');
    return { messages: result.data.slice(0, 30), hasMore: result.data.length > 30 };
  });