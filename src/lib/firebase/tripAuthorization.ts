import { Company, Trip, TripStatus } from '../../types/tms';
import { auth } from './client';

/**
 * Unified Verified-Owner Trip & Dispatch Authorization Layer
 *
 * Enforces the AnchorTransport TMS owner-authorized permission model:
 * - Authenticated Firebase Auth user with verified email (`email_verified === true`)
 * - Active company ownership verified against `company.ownerId === auth.currentUser.uid`
 * - Full operational control for the verified owner across Trips & Dispatch:
 *   create, read, edit (including post-dispatch corrections), dispatch, LR/POD updates,
 *   vehicle/driver reassignments, freight/expense updates, completion, reopening, and deletion.
 */

export interface TripAuthorizationContext {
  uid?: string | null;
  emailVerified?: boolean;
  company?: Pick<Company, 'id' | 'ownerId'> | null;
}

export interface TripAuthorizationResult {
  authorized: boolean;
  reason?: string;
}

export function checkVerifiedTripOwner(
  ctx?: TripAuthorizationContext
): TripAuthorizationResult {
  const currentUser = auth.currentUser;
  const uid = ctx?.uid ?? currentUser?.uid ?? null;
  const emailVerified =
    ctx?.emailVerified !== undefined
      ? ctx.emailVerified
      : currentUser?.emailVerified === true;

  if (!uid) {
    return {
      authorized: false,
      reason: 'Authentication required before performing Trip or Dispatch operations.',
    };
  }
  if (!emailVerified) {
    return {
      authorized: false,
      reason: 'Please verify your email address before managing Trips or Dispatches.',
    };
  }
  if (ctx?.company) {
    if (!ctx.company.id) {
      return {
        authorized: false,
        reason: 'Active company workspace is not loaded yet.',
      };
    }
    if (ctx.company.ownerId && ctx.company.ownerId !== uid) {
      return {
        authorized: false,
        reason: 'Only the verified company owner is authorized to manage this company’s Trips and Dispatch.',
      };
    }
  }
  return { authorized: true };
}

export function canCreateTrip(ctx?: TripAuthorizationContext): boolean {
  return checkVerifiedTripOwner(ctx).authorized;
}

export function canEditTrip(
  _trip: Trip,
  ctx?: TripAuthorizationContext
): boolean {
  // Verified company owner can edit any trip (including post-dispatch corrections, LR/POD, remarks, and reopening)
  return checkVerifiedTripOwner(ctx).authorized;
}

export function canDispatchTrip(
  trip: Trip,
  ctx?: TripAuthorizationContext
): boolean {
  return (
    checkVerifiedTripOwner(ctx).authorized &&
    (trip.status === 'PLANNED' || trip.status === 'DISPATCHED')
  );
}

export function canUpdatePodOrLr(
  _trip: Trip,
  ctx?: TripAuthorizationContext
): boolean {
  return checkVerifiedTripOwner(ctx).authorized;
}

export function canDeleteTrip(
  _trip: Trip,
  ctx?: TripAuthorizationContext
): boolean {
  return checkVerifiedTripOwner(ctx).authorized;
}

export function canReopenTrip(
  trip: Trip,
  ctx?: TripAuthorizationContext
): boolean {
  if (!checkVerifiedTripOwner(ctx).authorized) return false;
  return (
    trip.status === 'DISPATCHED' ||
    trip.status === 'IN_TRANSIT' ||
    trip.status === 'DELIVERED' ||
    trip.status === 'COMPLETED' ||
    trip.status === 'SETTLED' ||
    trip.status === 'CANCELLED'
  );
}

/**
 * Operational Trip Status Transition Matrix (Verified Owner-Authorized)
 *
 * Supports both forward operational progression and owner-authorized operational reopening:
 * - PLANNED     -> DISPATCHED, CANCELLED
 * - DISPATCHED  -> IN_TRANSIT, DELIVERED, PLANNED (reopen), CANCELLED
 * - IN_TRANSIT  -> DELIVERED, DISPATCHED (reopen), CANCELLED
 * - DELIVERED   -> COMPLETED, IN_TRANSIT (reopen), CANCELLED
 * - COMPLETED   -> DELIVERED (reopen when not locked, or to correct POD/delivery), SETTLED (if unsettled)
 * - SETTLED     -> COMPLETED, DELIVERED
 * - CANCELLED   -> PLANNED (reopen cancelled booking back to planned)
 */
export function getOperationalNextTripStatuses(
  trip: Pick<Trip, 'status' | 'isSettled'>
): TripStatus[] {
  switch (trip.status) {
    case 'PLANNED':
      return ['DISPATCHED', 'CANCELLED'];
    case 'DISPATCHED':
      return ['IN_TRANSIT', 'DELIVERED', 'PLANNED', 'CANCELLED'];
    case 'IN_TRANSIT':
      return ['DELIVERED', 'DISPATCHED', 'CANCELLED'];
    case 'DELIVERED':
      return ['COMPLETED', 'IN_TRANSIT', 'CANCELLED'];
    case 'COMPLETED':
      return trip.isSettled ? ['DELIVERED'] : ['DELIVERED', 'SETTLED'];
    case 'SETTLED':
      return ['COMPLETED', 'DELIVERED'];
    case 'CANCELLED':
      return ['PLANNED'];
    default:
      return [];
  }
}

export function isOperationalTripTransitionAllowed(
  fromStatus: TripStatus,
  toStatus: TripStatus,
  isSettled = false
): boolean {
  if (fromStatus === toStatus) return true;
  return getOperationalNextTripStatuses({ status: fromStatus, isSettled }).includes(toStatus);
}
