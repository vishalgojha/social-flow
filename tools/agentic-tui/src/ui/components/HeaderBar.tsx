import React from "react";
import { Box, Text } from "ink";
import { useTheme } from "../theme.js";

export function HeaderBar(props: {
  title: string;
  connected: number;
  total: number;
}): JSX.Element {
  const theme = useTheme();
  const statusColor = props.connected > 0 ? theme.success : theme.warning;
  return (
    <Box borderStyle="single" borderColor={theme.muted} paddingX={1} justifyContent="space-between">
      <Text color={theme.accent} bold>{props.title}</Text>
      <Text color={statusColor}>Connected: {props.connected}/{props.total}</Text>
    </Box>
  );
}

