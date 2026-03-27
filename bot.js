const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, Partials } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const TOKEN = process.env.TOKEN || "YOUR_BOT_TOKEN_HERE";
const ADMIN_ROLE_NAME = "Admin";
const ADMIN_USER_IDS = [
  "651784290475966494", // ← Ganti dengan User ID kamu
];
const STATUS_CHANNEL_ID = "1487006957884932139";
const FALLBACK_CHANNEL_ID = "ISI_ID_CHANNEL_NOTIFIKASI"; // ← Ganti! Channel server untuk notifikasi jika DM gagal
const HEARTBEAT_HOURS = 12;
const DB_PATH = path.join(__dirname, "rental_db.json");
const CHECK_INTERVAL_HOURS = 6;

// ─── DATABASE ─────────────────────────────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_PATH)) {
    const empty = { rentals: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── BOT SETUP ────────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping,
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
  ],
});

// ─── HELPER ───────────────────────────────────────────────────────────────────
function isAdmin(member, userId) {
  if (!member) return ADMIN_USER_IDS.includes(userId);
  return (
    ADMIN_USER_IDS.includes(userId) ||
    member.roles.cache.some((r) => r.name === ADMIN_ROLE_NAME) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

function daysUntil(dateStr) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  return Math.round((target - now) / (1000 * 60 * 60 * 24));
}

// ─── SEND DM (dengan fallback ke channel server) ──────────────────────────────
// Return value:
//   true     = DM berhasil
//   "fallback" = DM gagal, tapi berhasil kirim ke channel server
//   false    = keduanya gagal
async function sendDM(userId, embed, fallbackNote = null) {
  // Coba kirim DM dulu
  try {
    const user = await client.users.fetch(userId);
    await user.send({ embeds: [embed] });
    return true;
  } catch {
    console.log(`[WARN] Gagal DM ke user ${userId} — mencoba fallback channel.`);
  }

  // Fallback: kirim ke channel server dengan mention
  if (FALLBACK_CHANNEL_ID && FALLBACK_CHANNEL_ID !== "ISI_ID_CHANNEL_NOTIFIKASI") {
    try {
      const channel = await client.channels.fetch(FALLBACK_CHANNEL_ID);
      if (channel) {
        const note = fallbackNote
          ? fallbackNote
          : "Kamu punya notifikasi sewa lagu! (DM kamu tertutup, notifikasi dikirim di sini)";

        await channel.send({
          content: [
            `<@${userId}> ${note}`,
            `> ℹ️ Buka DM dari bot ini agar notifikasi berikutnya masuk langsung ke DM kamu:`,
            `> **User Settings → Privacy & Safety → Allow direct messages from server members ✅**`,
          ].join("\n"),
          embeds: [embed],
        });
        return "fallback";
      }
    } catch (err) {
      console.log(`[WARN] Fallback channel juga gagal: ${err.message}`);
    }
  }

  return false;
}

// ─── STATUS CHANNEL ───────────────────────────────────────────────────────────
async function sendStatusMessage(type) {
  if (!STATUS_CHANNEL_ID || STATUS_CHANNEL_ID === "YOUR_CHANNEL_ID_HERE") return;

  try {
    const channel = await client.channels.fetch(STATUS_CHANNEL_ID);
    if (!channel) return;

    const now = new Date().toLocaleString("id-ID", {
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });

    const db = loadDB();
    const totalPenyewa = db.rentals.length;
    const expiringSoon = db.rentals.filter((r) => {
      const d = daysUntil(r.expireDate);
      return d >= 0 && d <= 3;
    }).length;

    if (type === "online") {
      const embed = new EmbedBuilder()
        .setColor(0x00CC66)
        .setTitle("🟢 Bot Online")
        .setDescription("Bot sewa lagu berhasil dinyalakan dan siap digunakan!")
        .addFields(
          { name: "🕐 Waktu", value: now, inline: true },
          { name: "👥 Total Penyewa", value: `${totalPenyewa} orang`, inline: true },
          { name: "⚠️ Mau Expired (≤3 hari)", value: `${expiringSoon} orang`, inline: true }
        )
        .setFooter({ text: "Ketik !sewa help untuk daftar command" })
        .setTimestamp();
      await channel.send({ embeds: [embed] });

    } else if (type === "heartbeat") {
      const embed = new EmbedBuilder()
        .setColor(0x3399FF)
        .setTitle("💓 Bot Masih Aktif")
        .addFields(
          { name: "🕐 Waktu", value: now, inline: true },
          { name: "👥 Total Penyewa", value: `${totalPenyewa} orang`, inline: true },
          { name: "⚠️ Mau Expired (≤3 hari)", value: `${expiringSoon} orang`, inline: true }
        )
        .setTimestamp();
      await channel.send({ embeds: [embed] });
    }

  } catch (err) {
    console.log(`[WARN] Gagal kirim ke status channel: ${err.message}`);
  }
}

// ─── EMBED BUILDERS ───────────────────────────────────────────────────────────
function buildConfirmEmbed(rental) {
  return new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle("🎵 Konfirmasi Sewa Lagu")
    .setDescription(`Halo **${rental.username}**! Sewa lagu kamu sudah dikonfirmasi. Terima kasih!`)
    .addFields(
      { name: "🎶 Lagu / Paket", value: rental.songOrPackage, inline: true },
      { name: "📅 Aktif Hingga", value: formatDate(rental.expireDate), inline: true },
      { name: "📝 Catatan", value: rental.notes || "-", inline: false }
    )
    .setFooter({ text: "Bot Sewa Lagu • Hubungi admin jika ada pertanyaan" })
    .setTimestamp();
}

function buildReminderEmbed(rental, daysLeft) {
  const isUrgent = daysLeft <= 1;
  return new EmbedBuilder()
    .setColor(isUrgent ? 0xFF4444 : 0xFF8C00)
    .setTitle(isUrgent ? "🚨 Sewa Lagu Hampir Berakhir!" : "⚠️ Pengingat Sewa Lagu")
    .setDescription(
      isUrgent
        ? `Halo **${rental.username}**! Sewa lagu kamu **BERAKHIR BESOK**. Segera perpanjang!`
        : `Halo **${rental.username}**! Sewa lagu kamu akan berakhir dalam **${daysLeft} hari**.`
    )
    .addFields(
      { name: "🎶 Lagu / Paket", value: rental.songOrPackage, inline: true },
      { name: "📅 Berakhir", value: formatDate(rental.expireDate), inline: true }
    )
    .setFooter({ text: "Hubungi admin untuk perpanjang langganan" })
    .setTimestamp();
}

function buildStatusEmbed(rental) {
  const days = daysUntil(rental.expireDate);
  const statusText =
    days < 0 ? "❌ Sudah Expired" : days === 0 ? "🔴 Berakhir Hari Ini" : `✅ Aktif (${days} hari lagi)`;
  return new EmbedBuilder()
    .setColor(days <= 0 ? 0xFF4444 : days <= 3 ? 0xFF8C00 : 0x00CC66)
    .setTitle("📋 Status Sewa Lagu")
    .addFields(
      { name: "👤 User", value: rental.username, inline: true },
      { name: "🎶 Lagu / Paket", value: rental.songOrPackage, inline: true },
      { name: "📅 Aktif Hingga", value: formatDate(rental.expireDate), inline: true },
      { name: "🟢 Status", value: statusText, inline: true },
      { name: "📝 Catatan", value: rental.notes || "-", inline: false }
    )
    .setTimestamp();
}

// ─── REMINDER CHECKER ─────────────────────────────────────────────────────────
async function checkReminders() {
  const db = loadDB();
  console.log(`[INFO] Cek reminder... (${new Date().toLocaleString("id-ID")})`);

  for (const rental of db.rentals) {
    const days = daysUntil(rental.expireDate);

    if (days === 3 && !rental.reminded3) {
      const sent = await sendDM(
        rental.userId,
        buildReminderEmbed(rental, 3),
        "Sewa lagu kamu akan berakhir dalam 3 hari! Segera perpanjang."
      );
      if (sent) {
        rental.reminded3 = true;
        const via = sent === "fallback" ? "via channel (DM ditutup)" : "via DM";
        console.log(`[INFO] Reminder H-3 dikirim ke ${rental.username} ${via}`);
      }
    }

    if (days === 1 && !rental.reminded1) {
      const sent = await sendDM(
        rental.userId,
        buildReminderEmbed(rental, 1),
        "🚨 Sewa lagu kamu BERAKHIR BESOK! Segera hubungi admin untuk perpanjang."
      );
      if (sent) {
        rental.reminded1 = true;
        const via = sent === "fallback" ? "via channel (DM ditutup)" : "via DM";
        console.log(`[INFO] Reminder H-1 dikirim ke ${rental.username} ${via}`);
      }
    }
  }

  saveDB(db);
}

// ─── COMMAND HANDLER ──────────────────────────────────────────────────────────
async function handleCommand(message, isDM) {
  const args = message.content.slice(6).trim();
  const subArgs = args.split(/\s+/);
  const sub = subArgs[0]?.toLowerCase();
  const authorId = message.author.id;
  const member = isDM ? null : message.member;

  // ── !sewa add ──────────────────────────────────────────────────────────────
  if (sub === "add") {
    if (!isAdmin(member, authorId)) return message.reply("❌ Kamu tidak punya akses command ini.");

    let targetId, targetUsername;

    if (isDM) {
      const idMatch = args.match(/\b(\d{17,20})\b/);
      if (!idMatch) return message.reply("❌ Masukkan User ID!\nContoh: `!sewa add 123456789012345678 \"Paket DJ\" 2025-07-30 \"lunas\"`");
      targetId = idMatch[1];
      try {
        const fetchedUser = await client.users.fetch(targetId);
        targetUsername = fetchedUser.username;
      } catch {
        return message.reply("❌ User ID tidak ditemukan.");
      }
    } else {
      const mentionedUser = message.mentions.users.first();
      if (!mentionedUser) return message.reply("❌ Tag user-nya!\nContoh: `!sewa add @user \"Paket DJ\" 2025-07-30 \"lunas\"`");
      targetId = mentionedUser.id;
      targetUsername = mentionedUser.username;
    }

    const quotedStrings = [...args.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const dateMatch = args.match(/\b(\d{4}-\d{2}-\d{2})\b/);

    if (!quotedStrings[0] || !dateMatch) {
      return message.reply('❌ Format salah!\nContoh: `!sewa add <userId> "Paket DJ Premium" 2025-07-30 "dibayar via transfer"`');
    }

    const db = loadDB();
    const existingIdx = db.rentals.findIndex((r) => r.userId === targetId);

    const rental = {
      userId: targetId,
      username: targetUsername,
      songOrPackage: quotedStrings[0],
      expireDate: dateMatch[1],
      notes: quotedStrings[1] || "",
      addedAt: new Date().toISOString(),
      reminded3: false,
      reminded1: false,
    };

    if (existingIdx >= 0) {
      db.rentals[existingIdx] = rental;
      message.reply(`✅ Data sewa **${targetUsername}** diperbarui!`);
    } else {
      db.rentals.push(rental);
      message.reply(`✅ Data sewa **${targetUsername}** ditambahkan!`);
    }

    saveDB(db);

    // Kirim konfirmasi dengan fallback otomatis
    const sent = await sendDM(
      targetId,
      buildConfirmEmbed(rental),
      "Konfirmasi sewa lagu kamu sudah masuk! Cek detail di bawah ini."
    );

    if (!sent) {
      message.reply(`⚠️ DM ke **${targetUsername}** gagal & channel fallback tidak tersedia atau belum dikonfigurasi.`);
    } else if (sent === "fallback") {
      message.reply(`⚠️ DM ke **${targetUsername}** gagal (DM-nya tertutup), notifikasi sudah dikirim ke channel server.`);
    }
    // Kalau sent === true, tidak perlu reply tambahan

    return;
  }

  // ── !sewa remove ──────────────────────────────────────────────────────────
  if (sub === "remove") {
    if (!isAdmin(member, authorId)) return message.reply("❌ Kamu tidak punya akses command ini.");

    let targetId;

    if (isDM) {
      const idMatch = args.match(/\b(\d{17,20})\b/);
      if (!idMatch) return message.reply("❌ Masukkan User ID!\nContoh: `!sewa remove 123456789012345678`");
      targetId = idMatch[1];
    } else {
      const mentionedUser = message.mentions.users.first();
      if (!mentionedUser) return message.reply("❌ Tag user-nya!\nContoh: `!sewa remove @user`");
      targetId = mentionedUser.id;
    }

    const db = loadDB();
    const existing = db.rentals.find((r) => r.userId === targetId);
    if (!existing) return message.reply("❌ Data sewa tidak ditemukan.");

    db.rentals = db.rentals.filter((r) => r.userId !== targetId);
    saveDB(db);
    return message.reply(`✅ Data sewa **${existing.username}** dihapus.`);
  }

  // ── !sewa list ─────────────────────────────────────────────────────────────
  if (sub === "list") {
    if (!isAdmin(member, authorId)) return message.reply("❌ Kamu tidak punya akses command ini.");

    const db = loadDB();
    if (db.rentals.length === 0) return message.reply("📭 Belum ada data sewa.");

    const lines = db.rentals.map((r) => {
      const days = daysUntil(r.expireDate);
      const icon = days < 0 ? "❌" : days <= 1 ? "🔴" : days <= 3 ? "🟡" : "🟢";
      return `${icon} **${r.username}** (\`${r.userId}\`) — ${r.songOrPackage} — ${formatDate(r.expireDate)} (${days < 0 ? "expired" : days + " hari lagi"})`;
    });

    const embed = new EmbedBuilder()
      .setColor(0xFFD700)
      .setTitle("📋 Daftar Sewa Aktif")
      .setDescription(lines.join("\n"))
      .setFooter({ text: `Total: ${db.rentals.length} penyewa` })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }

  // ── !sewa cek ─────────────────────────────────────────────────────────────
  if (sub === "cek") {
    let targetId;

    if (isDM) {
      const idMatch = args.match(/\b(\d{17,20})\b/);
      if (idMatch) {
        if (!isAdmin(member, authorId)) return message.reply("❌ Hanya admin yang bisa cek status orang lain.");
        targetId = idMatch[1];
      } else {
        targetId = authorId;
      }
    } else {
      const mentionedUser = message.mentions.users.first();
      if (mentionedUser) {
        if (!isAdmin(member, authorId)) return message.reply("❌ Hanya admin yang bisa cek status orang lain.");
        targetId = mentionedUser.id;
      } else {
        targetId = authorId;
      }
    }

    const db = loadDB();
    const rental = db.rentals.find((r) => r.userId === targetId);
    if (!rental) return message.reply("❌ Data sewa tidak ditemukan.");

    return message.reply({ embeds: [buildStatusEmbed(rental)] });
  }

  // ── !sewa help ─────────────────────────────────────────────────────────────
  const helpEmbed = new EmbedBuilder()
    .setColor(0xFFD700)
    .setTitle("🎵 Bot Sewa Lagu — Command List")
    .addFields(
      {
        name: "👤 User",
        value: "`!sewa cek` — Cek status sewa kamu sendiri",
        inline: false,
      },
      {
        name: "🛠️ Admin via DM ke bot",
        value: [
          '`!sewa add <userId> "nama lagu" YYYY-MM-DD "catatan"` — Tambah/update sewa',
          "`!sewa remove <userId>` — Hapus data sewa",
          "`!sewa list` — Lihat semua penyewa",
          "`!sewa cek <userId>` — Cek status sewa user tertentu",
        ].join("\n"),
        inline: false,
      },
      {
        name: "🛠️ Admin via server",
        value: [
          '`!sewa add @user "nama lagu" YYYY-MM-DD "catatan"` — Tambah/update sewa',
          "`!sewa remove @user` — Hapus data sewa",
          "`!sewa list` — Lihat semua penyewa",
          "`!sewa cek @user` — Cek status sewa user tertentu",
        ].join("\n"),
        inline: false,
      }
    )
    .setFooter({ text: "Reminder otomatis dikirim H-3 dan H-1 sebelum expired" });

  message.reply({ embeds: [helpEmbed] });
}

// ─── MESSAGE CREATE ────────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.content.startsWith("!sewa")) return;

  const isDM = !message.guild;
  await handleCommand(message, isDM);
});

// ─── ON READY ─────────────────────────────────────────────────────────────────
client.once("clientReady", () => {
  console.log(`✅ Bot online sebagai ${client.user.tag}`);
  sendStatusMessage("online");
  checkReminders();
  setInterval(checkReminders, CHECK_INTERVAL_HOURS * 60 * 60 * 1000);
  if (HEARTBEAT_HOURS > 0) {
    setInterval(() => sendStatusMessage("heartbeat"), HEARTBEAT_HOURS * 60 * 60 * 1000);
  }
});

client.login(TOKEN);
