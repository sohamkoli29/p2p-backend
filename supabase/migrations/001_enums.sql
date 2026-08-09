create extension if not exists pgcrypto;

-- Custom enum types used across the P2P schema
create type user_role as enum ('admin', 'alemic', 'vendor');
create type pr_status as enum ('draft', 'submitted', 'approved', 'rejected');
create type rfq_status as enum ('open', 'closed', 'awarded');
create type quotation_status as enum ('submitted', 'awarded', 'rejected');
create type po_status as enum ('issued', 'accepted', 'declined', 'fulfilled');
create type grn_status as enum ('partial', 'complete');
create type invoice_status as enum ('submitted', 'matched', 'mismatched', 'approved', 'rejected', 'paid');