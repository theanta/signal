import { z } from 'zod';

/** Request bodies for adding and changing a user, shared by Team and Platform admin. */

export const AddUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  email: z.string().trim().email('Email is not valid'),
  role: z.enum(['admin', 'member']).default('member'),
  mode: z.enum(['invite', 'password']).default('invite'),
  password: z.string().optional(),
});

export const UpdateUserSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  is_active: z.boolean().optional(),
}).strict();
