import ws from "ws";
import * as dotenv from "dotenv";

dotenv.config();

if (!process.env.API_TOKEN) throw "Missing API_TOKEN";
if (!process.env.COOKIE) throw "Missing COOKIE";

const nameMap: Record<string, any> = {};
const channelMap: Record<string, any> = {};

async function getTokenOwnerUserId() {
  const authTestResp = await fetch("https://slack.com/api/auth.test", {
    headers: {
      Authorization: `Bearer ${process.env.API_TOKEN}`,
      Cookie: process.env.COOKIE || "",
    },
  });

  if (authTestResp.status !== 200) {
    console.log(authTestResp);
    throw "received non 200 from auth.test";
  }

  const authTestData = await authTestResp.json();
  if (!authTestData.ok) {
    console.log(authTestData);
    throw "Auth test data response not ok";
  }

  return authTestData.user_id;
}

async function getUserInfo(userId: string) {
  const userInfoResp = await fetch(
    `https://slack.com/api/users.info?user=${userId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.API_TOKEN}`,
        Cookie: process.env.COOKIE || "",
      },
    },
  );

  if (userInfoResp.status !== 200) {
    console.log(userInfoResp);
    throw "received non 200 from users.info";
  }

  const userInfoData = await userInfoResp.json();
  if (!userInfoData.ok) {
    if (userInfoData.error === "user_not_found") {
      return null;
    }

    console.log(userInfoData);
    throw "User info data response not ok";
  }

  return userInfoData.user;
}

async function getChannelInfo(channelId: string) {
  const channelInfoResp = await fetch(
    `https://slack.com/api/conversations.info?channel=${channelId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.API_TOKEN}`,
        Cookie: process.env.COOKIE || "",
      },
    },
  );

  if (channelInfoResp.status !== 200) {
    console.log(channelInfoResp);
    throw "received non 200 from conversations.info";
  }

  const channelInfoData = await channelInfoResp.json();
  if (!channelInfoData.ok) {
    console.log(channelInfoData);
    throw "Channel info data response not ok";
  }

  return channelInfoData.channel;
}

async function run() {
  const tokenOwnerUserId = await getTokenOwnerUserId();
  const userInfo = await getUserInfo(tokenOwnerUserId);
  nameMap[tokenOwnerUserId] = userInfo;

  const connectResp = await fetch("https://slack.com/api/rtm.connect", {
    headers: {
      Authorization: `Bearer ${process.env.API_TOKEN}`,
      Cookie: process.env.COOKIE || "",
    },
  });

  if (connectResp.status !== 200) {
    console.log(connectResp);
    throw "received non 200 from rtm.connect";
  }

  const connectData = await connectResp.json();
  if (!connectData.ok) {
    console.log(connectData);
    throw "Connection data response not ok";
  }

  const wsUrl = connectData.url;
  const socket = new ws(wsUrl, {
    headers: {
      Authorization: `Bearer ${process.env.API_TOKEN}`,
      Cookie: process.env.COOKIE || "",
    },
  });

  let connectionClosed = false;
  socket.on("open", () => {
    console.log("WebSocket connection opened");
  });

  socket.on("message", async (data) => {
    const parsedData = JSON.parse(data.toString());
    if (parsedData.type === "message") {
      const user = parsedData.user;
      const channel = parsedData.channel;

      if (!nameMap[user]) {
        const userInfo = await getUserInfo(user);
        if (userInfo) nameMap[user] = userInfo;
      }

      if (!channelMap[channel]) {
        const channelInfo = await getChannelInfo(channel);
        channelMap[channel] = channelInfo;
      }

      if (!parsedData.text) return;

      if (
        channelMap[channel].is_im || // DM
        (channelMap[channel].name === "lunch" &&
          parsedData.text.includes(":hungry_greendale_human_being:")) ||
        parsedData.text.includes(tokenOwnerUserId) || // User directly tagged
        parsedData.text
          .toLowerCase()
          .includes(nameMap[user]?.name.toLowerCase()) || // User name mentioned
        parsedData.text.includes("!channel") || // Channel-wide mention
        parsedData.text.includes("!here") // Channel-wide mention
      ) {
        let formattedText = parsedData.text;
        for (const [key, value] of Object.entries(nameMap)) {
          formattedText = formattedText.replace(key, value.name);
        }

        console.log(
          `🚨 ${nameMap[user]?.name} @ ${channelMap[channel].name ? `#${channelMap[channel].name}` : "DM"}: ${formattedText}`,
        );

        // System bell
        process.stdout.write("\u0007");
      }
    }
  });

  socket.on("close", () => {
    console.log("WebSocket connection closed");
    connectionClosed = true;
  });

  socket.on("error", (error) => {
    console.error("WebSocket error:", error);
    connectionClosed = true;
  });

  while (!connectionClosed) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

void run().then(() => process.exit(0));
