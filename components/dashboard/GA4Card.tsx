"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { GA4_CHANNELS, GA4_TOTAL } from "@/lib/ga4-static";

export default function GA4Card() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>GA4 Channel Overview</span>
          <Badge variant="outline" className="text-xs font-normal">
            Static data: {GA4_TOTAL.dateRange}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead className="text-right">New</TableHead>
              <TableHead className="text-right">Returning</TableHead>
              <TableHead className="text-right">Avg Engagement</TableHead>
              <TableHead className="text-right">Sessions/User</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="font-semibold bg-muted/30">
              <TableCell>Total</TableCell>
              <TableCell className="text-right font-mono">
                {GA4_TOTAL.users.toLocaleString()}
              </TableCell>
              <TableCell className="text-right font-mono">
                {GA4_TOTAL.newUsers.toLocaleString()}
              </TableCell>
              <TableCell className="text-right font-mono">
                {GA4_TOTAL.returningUsers.toLocaleString()}
              </TableCell>
              <TableCell className="text-right font-mono">
                {GA4_TOTAL.avgEngagement}
              </TableCell>
              <TableCell className="text-right font-mono">
                {GA4_TOTAL.sessionsPerUser}
              </TableCell>
            </TableRow>
            {GA4_CHANNELS.map((ch) => (
              <TableRow key={ch.channel}>
                <TableCell className="font-medium">{ch.channel}</TableCell>
                <TableCell className="text-right font-mono">
                  {ch.users.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {ch.newUsers.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {ch.returningUsers.toLocaleString()}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {ch.avgEngagement}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {ch.sessionsPerUser}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
