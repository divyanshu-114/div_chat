import { NextRequest, NextResponse } from "next/server"
import { redis } from "./lib/redis"
import { nanoid } from "nanoid"

const ROOM_TTL_SECONDS = 60 * 10

const connectedKey = (roomId: string) => `connected:${roomId}`
const metaKey = (roomId: string) => `meta:${roomId}`

export const proxy = async (req: NextRequest) => {
  const pathname = req.nextUrl.pathname

  const roomMatch = pathname.match(/^\/room\/([^/]+)$/)
  if (!roomMatch) return NextResponse.redirect(new URL("/", req.url))

  const roomId = roomMatch[1]

  // Room exists?
  const exists = await redis.exists(metaKey(roomId))
  if (!exists) {
    return NextResponse.redirect(new URL("/?error=room-not-found", req.url))
  }

  const existingToken = req.cookies.get("x-auth-token")?.value

  // If user already joined (token is already in set), allow
  if (existingToken) {
    const isMember = await redis.sismember(connectedKey(roomId), existingToken)
    if (isMember) return NextResponse.next()
  }

  // Check room capacity (max 2)
  const count = await redis.scard(connectedKey(roomId))
  if (count >= 3) {
    return NextResponse.redirect(new URL("/?error=room-full", req.url))
  }

  // Allow user & set token
  const response = NextResponse.next()
  const token = nanoid()

  response.cookies.set("x-auth-token", token, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax", // ✅ IMPORTANT: strict can cause issues with some flows; lax is safer for shared links
  })

  await redis.sadd(connectedKey(roomId), token)

  // Make sure connected set expires with room meta
  const ttl = await redis.ttl(metaKey(roomId))
  if (ttl > 0) {
    await redis.expire(connectedKey(roomId), ttl)
  } else {
    await redis.expire(connectedKey(roomId), ROOM_TTL_SECONDS)
  }

  return response
}

export const config = {
  matcher: "/room/:path*",
}
