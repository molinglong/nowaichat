import { NextRequest } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { ephemeralScope } from "@/lib/ephemeral"

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "登录已失效，请重新登录后再试" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  }

  const userId = session.user.id

  try {
    const body = await req.json()
    const { styleOffset }: { styleOffset: number } = body

    if (styleOffset === undefined || styleOffset < 0 || styleOffset > 100) {
      return new Response(
        JSON.stringify({ error: "风格强度需在 0-100 之间" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }

    // Update conversation's style offset if conversationId is provided
    // Otherwise, this would be used for new conversations only
    
    // For now, we'll just return success - the actual usage happens per-chat
    // The conversation's default can be updated if needed
    const convId = req.url.split('/style')[0].split('/').pop()
    
    if (convId && convId !== 'api') {
      await prisma.conversation.updateMany({
        where: {
          id: convId,
          userId,
          ...ephemeralScope(session),
        },
        data: {
          styleOffset,
        },
      })
      
      return Response.json({ 
        success: true, 
        message: `Style offset updated to ${styleOffset}` 
      })
    } else {
      // Return success for now - client will pass styleOffset per request
      return Response.json({ 
        success: true, 
        message: "Style offset accepted for current session" 
      })
    }
  } catch (error) {
    console.error("[conversation-style] Error:", error)
    return new Response(
      JSON.stringify({ error: "更新风格强度失败" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    )
  }
}
