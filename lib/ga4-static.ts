import { GA4Channel } from "./types";

// Static GA4 data from PDFs — Jan 1 to Apr 4, 2026
export const GA4_CHANNELS: GA4Channel[] = [
  {
    channel: "Direct",
    users: 9340,
    newUsers: 7888,
    returningUsers: 1349,
    avgEngagement: "2m 36s",
    sessionsPerUser: 1.73,
  },
  {
    channel: "Paid Social",
    users: 6259,
    newUsers: 6041,
    returningUsers: 580,
    avgEngagement: "32s",
    sessionsPerUser: 1.2,
  },
  {
    channel: "Organic Social",
    users: 1894,
    newUsers: 1853,
    returningUsers: 93,
    avgEngagement: "18s",
    sessionsPerUser: 1.05,
  },
  {
    channel: "Paid Search",
    users: 1773,
    newUsers: 1618,
    returningUsers: 363,
    avgEngagement: "3m 20s",
    sessionsPerUser: 1.73,
  },
  {
    channel: "Organic Search",
    users: 1341,
    newUsers: 1013,
    returningUsers: 412,
    avgEngagement: "7m 00s",
    sessionsPerUser: 2.62,
  },
  {
    channel: "Referral",
    users: 1280,
    newUsers: 978,
    returningUsers: 377,
    avgEngagement: "4m 32s",
    sessionsPerUser: 2.18,
  },
  {
    channel: "Cross-network",
    users: 519,
    newUsers: 470,
    returningUsers: 28,
    avgEngagement: "59s",
    sessionsPerUser: 1.05,
  },
  {
    channel: "Email",
    users: 230,
    newUsers: 164,
    returningUsers: 57,
    avgEngagement: "5m 00s",
    sessionsPerUser: 1.91,
  },
  {
    channel: "Display",
    users: 195,
    newUsers: 187,
    returningUsers: 11,
    avgEngagement: "22s",
    sessionsPerUser: 1.03,
  },
  {
    channel: "Unassigned",
    users: 64,
    newUsers: 66,
    returningUsers: 1,
    avgEngagement: "6s",
    sessionsPerUser: 0.86,
  },
];

export const GA4_TOTAL = {
  users: 23230,
  newUsers: 20336,
  returningUsers: 3285,
  avgEngagement: "2m 12s",
  sessionsPerUser: 1.56,
  dateRange: "Jan 1 - Apr 4, 2026",
};
