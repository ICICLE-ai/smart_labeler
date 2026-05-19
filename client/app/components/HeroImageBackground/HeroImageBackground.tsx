import cx from "clsx";
import { Title, Text, Container, Button, Overlay, Group } from "@mantine/core";
import classes from "./HeroImageBackground.module.css";
import { Link } from "@remix-run/react";

export function HeroImageBackground() {
  return (
    <div className={classes.wrapper}>
      <Overlay color="#000" opacity={0.65} zIndex={1} />

      <div className={classes.inner}>
        <Title className={classes.title}>
          {/* HARVEST{' '} */}
          <Text component="span" inherit className={classes.highlight}>
            Smart Labeler
          </Text>
        </Title>

        <Container size={640}>
          <Text size="lg" className={classes.description}>
            AI-Assisted Data Labeling for Every Research Domain
          </Text>
        </Container>

        <Group gap={15} className={classes.controls}>
          <Link to="/dashboard">
            <Button
              className={cx(classes.control)}
              size="lg"
              variant="gradient"
              gradient={{ from: "blue", to: "cyan", deg: 123 }}
              autoContrast
            >
              Get started
            </Button>
          </Link>
          <div>
            <Button
              component="a"
              href="https://www.youtube.com/watch?v=RlM7ZrZvJqM"
              target="_blank"
              rel="noopener noreferrer"
              className={cx(classes.control, classes.secondaryControl)}
              size="lg"
            >
              Live demo
            </Button>
          </div>
          
        </Group>
      </div>
    </div>
  );
}
